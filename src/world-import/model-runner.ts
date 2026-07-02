import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
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

export type WorldImportDebugOptions = {
  enabled?: boolean;
  showThinking?: boolean;
  showToolUpdates?: boolean;
};

export type WorldImportOutputSummary = {
  manifestExists: boolean;
  normalizedUnits: number;
  extractionStages: number;
  mergeStageExists: boolean;
  worldMarkdownFiles: number;
};

export type WorldImportRunOptions = {
  cwd?: string;
  packageRoot?: string;
  input: string;
  outputRoot: string;
  model?: string;
  reviewerModel?: string;
  thinking?: ThinkingLevel;
  dryRun?: boolean;
  debug?: WorldImportDebugOptions;
  onText?: (text: string) => void;
  onStatus?: (text: string) => void;
  onThinking?: (text: string) => void;
  onToolEvent?: (text: string) => void;
};

export type WorldImportRunResult = {
  responseText: string;
  model?: string;
  outputRoot: string;
  outputSummary: WorldImportOutputSummary;
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

export function finalizeAssistantMessageForCli(text: string, currentMessageHadText: boolean): string {
  return currentMessageHadText && text.length > 0 && !text.endsWith("\n") ? `${text}\n` : text;
}

function status(options: WorldImportRunOptions, text: string): void {
  if (options.debug?.enabled) options.onStatus?.(`[world-import] ${text}\n`);
}

function stringifyForLog(value: unknown, maxLength = 4000): string {
  let rendered: string;
  try {
    rendered = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  } catch {
    rendered = String(value);
  }
  return rendered.length > maxLength ? `${rendered.slice(0, maxLength)}…` : rendered;
}

function eventRecord(event: unknown): Record<string, unknown> {
  return event && typeof event === "object" ? event as Record<string, unknown> : {};
}

async function countFiles(dir: string, predicate: (name: string) => boolean): Promise<number> {
  if (!existsSync(dir)) return 0;
  let count = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) count += await countFiles(path, predicate);
    else if (entry.isFile() && predicate(entry.name)) count += 1;
  }
  return count;
}

export async function inspectWorldImportOutput(outputRoot: string): Promise<WorldImportOutputSummary> {
  const manifestPath = join(outputRoot, "sources", "manifest.json");
  let normalizedUnits = 0;
  if (existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(await readFile(manifestPath, "utf-8")) as { units?: unknown[] };
      normalizedUnits = Array.isArray(manifest.units) ? manifest.units.length : 0;
    } catch {
      normalizedUnits = 0;
    }
  }
  return {
    manifestExists: existsSync(manifestPath),
    normalizedUnits,
    extractionStages: await countFiles(join(outputRoot, "stages", "extraction"), (name) => name.endsWith(".json")),
    mergeStageExists: existsSync(join(outputRoot, "stages", "merge", "merged-candidates.json")),
    worldMarkdownFiles: await countFiles(join(outputRoot, "world"), (name) => name.endsWith(".md")),
  };
}

export async function runWorldImportSkill(options: WorldImportRunOptions): Promise<WorldImportRunResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const packageRoot = resolve(options.packageRoot ?? defaultPackageRoot());
  const helperCommand = cwd === packageRoot ? "npm run world-import-helper --" : "memchat-world-import-helper";
  const agentDir = getAgentDir();
  status(options, `cwd=${cwd}`);
  status(options, `packageRoot=${packageRoot}`);
  status(options, `input=${resolve(options.input)}`);
  status(options, `output=${resolve(options.outputRoot)}`);
  status(options, `agentDir=${agentDir}`);
  status(options, `helperCommand=${helperCommand}`);
  const authPath = resolve(agentDir, "auth.json");
  const modelsPath = resolve(agentDir, "models.json");
  status(options, `authPath=${authPath} (${existsSync(authPath) ? "exists" : "missing"})`);
  status(options, `modelsPath=${modelsPath} (${existsSync(modelsPath) ? "exists" : "missing"})`);
  const authStorage = AuthStorage.create(authPath);
  const modelRegistry = ModelRegistry.create(authStorage, modelsPath);
  const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, packages: [packageRoot] });
  status(options, "loading world-import skill");
  const skill = worldImportSkill(packageRoot);
  status(options, `loaded skill ${skill.name} from ${skill.filePath}`);
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    noContextFiles: true,
    skillsOverride: (current) => ({ skills: [...current.skills, skill], diagnostics: current.diagnostics }),
  });
  await resourceLoader.reload();
  status(options, "resource loader ready; creating agent session");

  const { session } = await createAgentSession({
    cwd,
    agentDir,
    authStorage,
    modelRegistry,
    resourceLoader,
    settingsManager,
    sessionManager: SessionManager.inMemory(cwd),
    thinkingLevel: options.thinking ?? "low",
  });

  try {
    status(options, `session created; initial model=${isUsableModel(session.model) ? modelLabel(session.model) : "none"}; thinking=${session.thinkingLevel}`);
    if (options.model) {
      status(options, `resolving requested model=${options.model}`);
      await session.setModel(requireResolvedModel(options.model, session.modelRegistry));
    }
    if (options.thinking) session.setThinkingLevel(options.thinking);
    if (!isUsableModel(session.model)) throw new Error("No usable model selected. Pass --model provider/model or configure a default pi model.");
    status(options, `active model=${modelLabel(session.model)}; thinking=${session.thinkingLevel}`);

    let responseText = "";
    let thinkingStarted = false;
    let currentAssistantMessageHadText = false;
    const debugTools = options.debug?.enabled;
    const unsubscribe = session.subscribe((event) => {
      if (event.type === "message_start" && event.message.role === "assistant") currentAssistantMessageHadText = false;
      if (event.type === "message_update") {
        const messageEvent = event.assistantMessageEvent;
        if (messageEvent.type === "text_delta") {
          currentAssistantMessageHadText = true;
          responseText += messageEvent.delta;
          options.onText?.(messageEvent.delta);
        } else if (messageEvent.type === "thinking_delta" && options.debug?.showThinking) {
          if (!thinkingStarted) {
            thinkingStarted = true;
            options.onThinking?.("\n[world-import thinking]\n");
          }
          options.onThinking?.(messageEvent.delta);
        }
      }
      if (event.type === "message_end" && event.message.role === "assistant") {
        const finalized = finalizeAssistantMessageForCli(responseText, currentAssistantMessageHadText);
        if (finalized !== responseText) {
          responseText = finalized;
          options.onText?.("\n");
        }
        currentAssistantMessageHadText = false;
      }
      if (debugTools && event.type === "tool_execution_start") {
        options.onToolEvent?.(`\n[world-import tool/start] ${event.toolName} ${stringifyForLog(event.args)}\n`);
      }
      if (debugTools && options.debug?.showToolUpdates && event.type === "tool_execution_update") {
        options.onToolEvent?.(`\n[world-import tool/update] ${stringifyForLog(eventRecord(event))}\n`);
      }
      if (debugTools && event.type === "tool_execution_end") {
        const record = eventRecord(event);
        options.onToolEvent?.(`\n[world-import tool/end] ${event.toolName} ${event.isError ? "error" : "ok"} ${stringifyForLog(record.details ?? record.result ?? record, 8000)}\n`);
      }
    });
    try {
      const prompt = renderWorldImportSkillInvocation({ ...options, helperCommand });
      status(options, `prompt=${prompt}`);
      status(options, "invoking model/skill");
      await session.prompt(prompt);
      status(options, "model/skill run completed");
    } finally {
      unsubscribe();
    }
    const outputSummary = await inspectWorldImportOutput(options.outputRoot);
    status(options, `output summary=${JSON.stringify(outputSummary)}`);
    return { responseText, model: modelLabel(session.model), outputRoot: options.outputRoot, outputSummary };
  } finally {
    status(options, "disposing session");
    session.dispose();
  }
}
