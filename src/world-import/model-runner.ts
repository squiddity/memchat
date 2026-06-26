import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  loadSkillsFromDir,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  type Skill,
} from "@earendil-works/pi-coding-agent";
import { isUsableModel, modelLabel, requireResolvedModel, type ThinkingLevel } from "../model-selection.js";

export type WorldImportRunOptions = {
  cwd?: string;
  packageRoot?: string;
  input: string;
  outputRoot: string;
  model?: string;
  reviewerModel?: string;
  thinking?: ThinkingLevel;
  dryRun?: boolean;
  onText?: (text: string) => void;
};

export type WorldImportRunResult = {
  responseText: string;
  model?: string;
  outputRoot: string;
};

export function defaultPackageRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../..");
}

export function worldImportSkill(packageRoot = defaultPackageRoot()): Skill {
  const baseDir = resolve(packageRoot, "skills", "world-import");
  if (!existsSync(resolve(baseDir, "SKILL.md"))) throw new Error(`world-import skill not found at ${resolve(baseDir, "SKILL.md")}`);
  const result = loadSkillsFromDir({ dir: baseDir, source: "memchat" });
  if (result.diagnostics.length > 0) {
    const detail = result.diagnostics.map((diagnostic) => `${diagnostic.path}: ${diagnostic.message}`).join("; ");
    throw new Error(`Failed to load world-import skill: ${detail}`);
  }
  const skill = result.skills.find((candidate) => candidate.name === "world-import");
  if (!skill) throw new Error(`world-import skill not found in ${baseDir}`);
  return skill;
}

export function renderWorldImportSkillInvocation(options: Pick<WorldImportRunOptions, "input" | "outputRoot" | "reviewerModel" | "dryRun"> & { helperCommand?: string }): string {
  return `/skill:world-import ${JSON.stringify({
    input: options.input,
    output: options.outputRoot,
    helperCommand: options.helperCommand,
    reviewerModel: options.reviewerModel,
    dryRun: options.dryRun ?? false,
  })}`;
}

export async function runWorldImportSkill(options: WorldImportRunOptions): Promise<WorldImportRunResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const packageRoot = resolve(options.packageRoot ?? defaultPackageRoot());
  const helperCommand = cwd === packageRoot ? "npm run world-import-helper --" : "memchat-world-import-helper";
  const agentDir = getAgentDir();
  const authStorage = AuthStorage.create(resolve(agentDir, "auth.json"));
  const modelRegistry = ModelRegistry.create(authStorage, resolve(agentDir, "models.json"));
  const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, packages: [packageRoot] });
  const skill = worldImportSkill(packageRoot);
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    noContextFiles: true,
    skillsOverride: (current) => ({ skills: [...current.skills, skill], diagnostics: current.diagnostics }),
  });
  await resourceLoader.reload();

  const { session } = await createAgentSession({
    cwd,
    agentDir,
    authStorage,
    modelRegistry,
    resourceLoader,
    settingsManager,
    sessionManager: SessionManager.inMemory(cwd),
    thinkingLevel: options.thinking ?? "off",
  });

  try {
    if (options.model) await session.setModel(requireResolvedModel(options.model, session.modelRegistry));
    if (options.thinking) session.setThinkingLevel(options.thinking);
    if (!isUsableModel(session.model)) throw new Error("No usable model selected. Pass --model provider/model or configure a default pi model.");

    let responseText = "";
    const unsubscribe = session.subscribe((event) => {
      if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
        responseText += event.assistantMessageEvent.delta;
        options.onText?.(event.assistantMessageEvent.delta);
      }
    });
    try {
      await session.prompt(renderWorldImportSkillInvocation({ ...options, helperCommand }));
    } finally {
      unsubscribe();
    }
    return { responseText, model: modelLabel(session.model), outputRoot: options.outputRoot };
  } finally {
    session.dispose();
  }
}
