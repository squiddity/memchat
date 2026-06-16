#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { argv, stdin as input, stdout as output } from "node:process";
import readline from "node:readline/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  loadSkillsFromDir,
  ModelRegistry,
  type PackageSource,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { createMemoryBackend, isMemoryModeId, memoryModeIds, resolveMemoryMode, type MemoryBackend, type MemoryMode, type MemoryModeId } from "./memory.js";
import type { Skill } from "@earendil-works/pi-coding-agent";

const cwd = process.cwd();
const agentDir = getAgentDir();
const requireFromHere = createRequire(import.meta.url);

const validThinkingLevels = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;
type ThinkingLevel = (typeof validThinkingLevels)[number];
type PiModel = ReturnType<ModelRegistry["getAll"]>[number];

type CliOptions = {
  provider?: string;
  model?: string;
  thinking?: ThinkingLevel;
  listModels?: string | true;
  memory: MemoryModeId;
};

type ModelResolution = {
  model?: PiModel;
  thinking?: ThinkingLevel;
  error?: string;
  matches?: PiModel[];
};

type MemchatPackageJson = {
  memchat?: {
    /** npm package names or local paths containing pi package resources. */
    piPackages?: string[];
  };
};

const chatSystemPrompt = `You are Memchat, a warm, internally consistent chat and fiction partner.

Memchat may provide a "Relevant remembered context" block before a user message. Treat that block as retrieved memory, prefer it over invention, and use its citations when helpful.
If no memory context is provided, only rely on the active session context.

Conversation priorities:
- Be conversational and concise by default.
- For fiction, invention is allowed, but maintain consistency with details already established in this session.
- If the user asks for something that depends on missing memory, ask or state uncertainty instead of fabricating continuity.
- Do not overstate memory confidence; distinguish retrieved context from guesses.`;

function readLocalPiPackageSpecs(): string[] {
  const packageJsonPath = resolve(cwd, "package.json");
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as MemchatPackageJson;
  const fromPackageJson = packageJson.memchat?.piPackages ?? [];
  const fromEnv = process.env.MEMCHAT_PI_PACKAGES?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];
  return [...fromPackageJson, ...fromEnv];
}

function resolveLocalPiPackage(specifier: string): string {
  if (specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("~")) {
    const expanded = specifier.startsWith("~/") ? resolve(process.env.HOME ?? cwd, specifier.slice(2)) : specifier;
    return isAbsolute(expanded) ? expanded : resolve(cwd, expanded);
  }

  try {
    return dirname(requireFromHere.resolve(`${specifier}/package.json`, { paths: [cwd] }));
  } catch {
    let entrypoint: string;
    try {
      entrypoint = requireFromHere.resolve(specifier, { paths: [cwd] });
    } catch (error) {
      throw new Error(
        `Could not resolve npm-managed pi package "${specifier}" from local node_modules. ` +
          `Install it first with: npm install ${specifier}`,
        { cause: error },
      );
    }

    let current = dirname(entrypoint);
    while (current !== dirname(current)) {
      if (existsSync(resolve(current, "package.json"))) return current;
      current = dirname(current);
    }
    throw new Error(`Could not find package root for "${specifier}".`);
  }
}

function getLocalPiPackageSources(): PackageSource[] {
  return readLocalPiPackageSpecs().map(resolveLocalPiPackage);
}

function loadLocalEnv() {
  const envPath = resolve(cwd, ".env");
  if (!existsSync(envPath)) return;

  for (const rawLine of readFileSync(envPath, "utf-8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const equalsIndex = line.indexOf("=");
    if (equalsIndex === -1) continue;

    const key = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1).trim();
    if (!key || process.env[key] !== undefined) continue;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function isThinkingLevel(value: string): value is ThinkingLevel {
  return validThinkingLevels.includes(value as ThinkingLevel);
}

function parseCliOptions(args: string[]): CliOptions {
  const options: Partial<CliOptions> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--provider" && args[i + 1]) {
      options.provider = args[++i];
    } else if (arg === "--model" && args[i + 1]) {
      options.model = args[++i];
    } else if (arg === "--thinking" && args[i + 1]) {
      const thinking = args[++i];
      if (!isThinkingLevel(thinking)) throw new Error(`Invalid --thinking value "${thinking}". Use: ${validThinkingLevels.join(", ")}`);
      options.thinking = thinking;
    } else if (arg === "--list-models") {
      const next = args[i + 1];
      options.listModels = next && !next.startsWith("-") ? args[++i] : true;
    } else if (arg === "--memory" && args[i + 1]) {
      const memory = args[++i];
      if (!isMemoryModeId(memory)) throw new Error(`Invalid --memory value "${memory}". Use: ${memoryModeIds.join(", ")}`);
      options.memory = memory;
    }
  }

  options.provider ??= process.env.MEMCHAT_PROVIDER;
  options.model ??= process.env.MEMCHAT_MODEL;
  const envThinking = process.env.MEMCHAT_THINKING;
  if (!options.thinking && envThinking) {
    if (!isThinkingLevel(envThinking)) throw new Error(`Invalid MEMCHAT_THINKING value "${envThinking}". Use: ${validThinkingLevels.join(", ")}`);
    options.thinking = envThinking;
  }
  const envMemory = process.env.MEMCHAT_MEMORY;
  if (!options.memory && envMemory) {
    if (!isMemoryModeId(envMemory)) throw new Error(`Invalid MEMCHAT_MEMORY value "${envMemory}". Use: ${memoryModeIds.join(", ")}`);
    options.memory = envMemory;
  }
  options.memory ??= "none";
  return options as CliOptions;
}

function modelLabel(model: PiModel): string {
  return `${model.provider}/${model.id}`;
}

function isUsableModel(model: PiModel | undefined): model is PiModel {
  return Boolean(model && model.provider !== "unknown" && model.id !== "unknown");
}

function splitThinkingSuffix(specifier: string): { pattern: string; thinking?: ThinkingLevel } {
  const colonIndex = specifier.lastIndexOf(":");
  if (colonIndex === -1) return { pattern: specifier };

  const suffix = specifier.slice(colonIndex + 1);
  if (!isThinkingLevel(suffix)) return { pattern: specifier };
  return { pattern: specifier.slice(0, colonIndex), thinking: suffix };
}

function resolveModel(specifier: string, modelRegistry: ModelRegistry, provider?: string): ModelResolution {
  const { pattern, thinking } = splitThinkingSuffix(specifier.trim());
  const providerSeparator = pattern.indexOf("/");
  const explicitProvider = providerSeparator === -1 ? provider : pattern.slice(0, providerSeparator);
  const modelPattern = providerSeparator === -1 ? pattern : pattern.slice(providerSeparator + 1);
  const normalizedPattern = modelPattern.toLowerCase();

  const allModels = modelRegistry.getAll();
  const providerCandidates = explicitProvider ? allModels.filter((model) => model.provider === explicitProvider) : allModels;
  if (providerCandidates.length === 0) {
    return { error: explicitProvider ? `No configured models for provider "${explicitProvider}".` : "No configured models found." };
  }

  const exactMatches = providerCandidates.filter(
    (model) => model.id.toLowerCase() === normalizedPattern || modelLabel(model).toLowerCase() === pattern.toLowerCase(),
  );
  const partialMatches = exactMatches.length > 0 ? exactMatches : providerCandidates.filter((model) => {
    const name = typeof model.name === "string" ? model.name.toLowerCase() : "";
    return model.id.toLowerCase().includes(normalizedPattern) || modelLabel(model).toLowerCase().includes(pattern.toLowerCase()) || name.includes(normalizedPattern);
  });

  if (partialMatches.length === 0) return { error: `No model matched "${specifier}".` };

  const available = modelRegistry.getAvailable();
  const availableKeys = new Set(available.map(modelLabel));
  const sorted = [...partialMatches].sort((a, b) => Number(availableKeys.has(modelLabel(b))) - Number(availableKeys.has(modelLabel(a))));
  if (sorted.length > 1 && !explicitProvider && exactMatches.length > 1) {
    return { error: `Ambiguous model "${specifier}". Use provider/model.`, matches: sorted };
  }
  return { model: sorted[0], thinking, matches: sorted };
}

function printModelList(modelRegistry: ModelRegistry, search?: string) {
  const query = search?.toLowerCase();
  const availableKeys = new Set(modelRegistry.getAvailable().map(modelLabel));
  const models = modelRegistry
    .getAll()
    .filter((model) => !query || modelLabel(model).toLowerCase().includes(query) || model.id.toLowerCase().includes(query))
    .sort((a, b) => modelLabel(a).localeCompare(modelLabel(b)));

  if (models.length === 0) {
    output.write(search ? `No models matching "${search}".\n` : "No configured models found.\n");
    return;
  }

  output.write("\nModels:\n");
  for (const model of models) {
    output.write(`  ${availableKeys.has(modelLabel(model)) ? "*" : " "} ${modelLabel(model)}${model.reasoning ? "  thinking" : ""}\n`);
  }
  output.write("\n* = auth configured/available\n");
}

function printCurrentModel(model: PiModel | undefined, thinking: string) {
  output.write(`Current model: ${isUsableModel(model) ? modelLabel(model) : "none selected"}\n`);
  output.write(`Thinking: ${thinking}\n`);
}

function printBanner(packageSources: PackageSource[], model: PiModel | undefined, thinking: string, memory: MemoryBackend, memoryMode: MemoryMode) {
  output.write("\nmemchat hello-world\n");
  output.write("Type a message and press Enter. Commands: /help, /model, /memory, /plugins, /exit\n");
  output.write(`Memory: ${memoryMode.id} (backend: ${memory.id}, persistence: ${memoryMode.persistence}, retrieval: ${memoryMode.retrieval})\n`);
  if (memoryMode.allowSkillTools) output.write("Tools: built-in pi tools enabled so memory skills can invoke declared tools such as Bash(qmd:*).\n");
  output.write(`Model: ${isUsableModel(model) ? modelLabel(model) : "none selected"} (thinking: ${thinking})\n`);
  output.write(`Local pi packages: ${packageSources.length === 0 ? "none" : packageSources.join(", ")}\n\n`);
}

async function printMemoryStatus(memory: MemoryBackend, memoryMode: MemoryMode) {
  const status = await memory.status();
  output.write(`Memory mode: ${memoryMode.id}\n`);
  output.write(`Backend: ${status.id}\n`);
  output.write(`Persistence: ${memoryMode.persistence}\n`);
  output.write(`Retrieval: ${memoryMode.retrieval}\n`);
  output.write(`Skills: ${memoryMode.skills.length === 0 ? "none" : memoryMode.skills.join(", ")}\n`);
  output.write(`Enabled: ${status.enabled ? "yes" : "no"}\n`);
  output.write(`${status.description}\n`);
  if (status.root) output.write(`Root: ${status.root}\n`);
  if (status.sessionId) output.write(`Session: ${status.sessionId}\n`);
  for (const note of status.notes ?? []) output.write(`- ${note}\n`);
}

function printMemoryBackends() {
  output.write(`Memory modes: ${memoryModeIds.join(", ")}\n`);
}

function resolvePackageRoot(packageName: string): string {
  const packageRoot = resolve(cwd, "node_modules", ...packageName.split("/"));
  if (!existsSync(resolve(packageRoot, "package.json"))) {
    throw new Error(`Memory mode requires local package ${packageName}. Run npm install so ${packageName}'s CLI and skills are available.`);
  }
  return packageRoot;
}

function getMemorySkills(memoryMode: MemoryMode): Skill[] {
  if (!memoryMode.skills.includes("qmd")) return [];
  const qmdRoot = resolvePackageRoot("@tobilu/qmd");
  const localQmdBin = resolve(cwd, "node_modules", ".bin", process.platform === "win32" ? "qmd.cmd" : "qmd");
  const packageQmdBin = join(qmdRoot, "bin", "qmd");
  if (!existsSync(localQmdBin) && !existsSync(packageQmdBin)) {
    throw new Error(`Memory mode requires the local qmd executable from @tobilu/qmd. Run npm install and verify ${localQmdBin} exists.`);
  }
  const skillDir = join(qmdRoot, "skills", "qmd");
  const result = loadSkillsFromDir({ dir: skillDir, source: "@tobilu/qmd" });
  if (result.diagnostics.length > 0) {
    const detail = result.diagnostics.map((diagnostic) => `${diagnostic.path}: ${diagnostic.message}`).join("; ");
    throw new Error(`Failed to load @tobilu/qmd skill: ${detail}`);
  }
  const qmdSkill = result.skills.find((skill) => skill.name === "qmd");
  if (!qmdSkill) throw new Error(`Package @tobilu/qmd did not provide skills/qmd/SKILL.md. Reinstall or pin a compatible @tobilu/qmd version.`);
  return [qmdSkill];
}

function formatPromptWithMemory(userText: string, memoryContext: string): string {
  if (!memoryContext) return userText;
  return `${memoryContext}\n\nCurrent user message:\n${userText}`;
}

function printHelp() {
  output.write(
    `\nCommands:\n` +
      `  /help                Show this help\n` +
      `  /model               Show the active model\n` +
      `  /model list [text]   List configured models (* means auth is available)\n` +
      `  /model <model>       Switch model, e.g. /model openai/gpt-4o or /model sonnet:high\n` +
      `  /model next|prev     Cycle models\n` +
      `  /memory              Show selected memory backend\n` +
      `  /memory status       Show memory backend status\n` +
      `  /memory backends     List available memory backends\n` +
      `  /memory recall <q>   Search memory\n` +
      `  /memory index        Initialize/reindex memory files\n` +
      `  /plugins             Show npm-managed local pi packages configured for this run\n` +
      `  /exit                End the chat\n\n` +
      `Startup options/env: --model, --provider, --thinking, --memory, --list-models; MEMCHAT_MODEL, MEMCHAT_PROVIDER, MEMCHAT_THINKING, MEMCHAT_MEMORY.\n` +
      `Configure local pi packages with package.json memchat.piPackages or MEMCHAT_PI_PACKAGES.\n\n`,
  );
}

async function main() {
  loadLocalEnv();
  const cliOptions = parseCliOptions(argv.slice(2));
  const packageSources = getLocalPiPackageSources();
  const memoryMode = resolveMemoryMode(cliOptions.memory);
  const memory = createMemoryBackend({ id: memoryMode.backend, cwd });
  const memorySkills = getMemorySkills(memoryMode);
  const authStorage = AuthStorage.create(resolve(agentDir, "auth.json"));
  const modelRegistry = ModelRegistry.create(authStorage, resolve(agentDir, "models.json"));

  const initialThinking = cliOptions.thinking ?? "off";

  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: false },
    packages: packageSources,
  });

  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    additionalExtensionPaths: [resolve(cwd, "extensions/lemonade-provider.ts")],
    noExtensions: true,
    noContextFiles: true,
    systemPrompt: chatSystemPrompt,
    skillsOverride: (current) => ({
      skills: [...current.skills, ...memorySkills],
      diagnostics: current.diagnostics,
    }),
  });
  await resourceLoader.reload();

  const extensionErrors = resourceLoader.getExtensions().errors;
  for (const error of extensionErrors) {
    output.write(`[extension error] ${error.path}: ${error.error}\n`);
  }

  const { session } = await createAgentSession({
    cwd,
    agentDir,
    authStorage,
    modelRegistry,
    resourceLoader,
    settingsManager,
    sessionManager: SessionManager.inMemory(cwd),
    ...(memoryMode.allowSkillTools ? {} : { noTools: "builtin" as const }),
    thinkingLevel: initialThinking,
  });

  if (cliOptions.model) {
    const resolved = resolveModel(cliOptions.model, session.modelRegistry, cliOptions.provider);
    if (resolved.error) {
      output.write(`[model warning] ${resolved.error}\n`);
      if (resolved.matches && resolved.matches.length > 0) {
        output.write(resolved.matches.slice(0, 10).map((model) => `  ${modelLabel(model)}\n`).join(""));
      }
    } else if (resolved.model) {
      try {
        await session.setModel(resolved.model);
        if (resolved.thinking) session.setThinkingLevel(resolved.thinking);
      } catch (error) {
        output.write(`[model warning] Could not select ${modelLabel(resolved.model)}: ${error instanceof Error ? error.message : String(error)}\n`);
      }
    }
  }

  if (cliOptions.listModels) {
    printModelList(session.modelRegistry, cliOptions.listModels === true ? undefined : cliOptions.listModels);
    await memory.dispose?.();
    session.dispose();
    return;
  }

  const rl = readline.createInterface({ input, output });
  let activeAssistantText = "";

  session.subscribe((event) => {
    if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
      activeAssistantText += event.assistantMessageEvent.delta;
      output.write(event.assistantMessageEvent.delta);
    }
  });

  printBanner(packageSources, session.model, session.thinkingLevel, memory, memoryMode);

  async function handleInput(line: string): Promise<boolean> {
    const text = line.trim();
    if (!text) return true;

    if (text === "/exit" || text === "/quit") return false;
    if (text === "/help") {
      printHelp();
      return true;
    }
    if (text === "/model") {
      printCurrentModel(session.model, session.thinkingLevel);
      return true;
    }
    if (text === "/memory" || text === "/memory status") {
      await printMemoryStatus(memory, memoryMode);
      return true;
    }
    if (text === "/memory backends") {
      printMemoryBackends();
      return true;
    }
    if (text.startsWith("/memory recall ")) {
      const query = text.slice("/memory recall ".length).trim();
      const hits = await memory.recall(query);
      if (hits.length === 0) output.write("No memory hits.\n");
      else {
        for (const [index, hit] of hits.entries()) {
          output.write(`${index + 1}. [${hit.kind}:${hit.source}${hit.timestamp ? ` @ ${hit.timestamp}` : ""}${hit.score !== undefined ? ` score=${hit.score}` : ""}] ${hit.text}\n`);
        }
      }
      return true;
    }
    if (text === "/memory index") {
      output.write(`${memory.index ? await memory.index() : "This backend does not support indexing."}\n`);
      return true;
    }
    if (text.startsWith("/model ")) {
      const args = text.slice("/model ".length).trim();
      if (args === "list" || args.startsWith("list ")) {
        printModelList(session.modelRegistry, args === "list" ? undefined : args.slice("list ".length).trim());
        return true;
      }
      if (args === "next" || args === "prev" || args === "previous") {
        const result = await session.cycleModel(args === "next" ? "forward" : "backward");
        if (!result) output.write("No alternate model available.\n");
        else output.write(`Switched to ${modelLabel(result.model)} (thinking: ${result.thinkingLevel})\n`);
        return true;
      }

      const resolved = resolveModel(args.startsWith("set ") ? args.slice("set ".length).trim() : args, session.modelRegistry);
      if (resolved.error || !resolved.model) {
        output.write(`${resolved.error ?? "Model not found."}\n`);
        if (resolved.matches && resolved.matches.length > 0) {
          output.write(resolved.matches.slice(0, 10).map((model) => `  ${modelLabel(model)}\n`).join(""));
        }
        return true;
      }

      try {
        await session.setModel(resolved.model);
        if (resolved.thinking) session.setThinkingLevel(resolved.thinking);
        output.write(`Switched to ${modelLabel(resolved.model)} (thinking: ${session.thinkingLevel})\n`);
      } catch (error) {
        output.write(`Could not switch model: ${error instanceof Error ? error.message : String(error)}\n`);
      }
      return true;
    }
    if (text === "/plugins") {
      output.write(
        `\nLocal pi packages:\n${packageSources.length === 0 ? "  none\n" : packageSources.map((source) => `  ${source}`).join("\n") + "\n"}\n`,
      );
      return true;
    }

    output.write("memchat> ");
    activeAssistantText = "";
    try {
      const memoryContext = memoryMode.retrieval === "hardwired" || memoryMode.retrieval === "hybrid" ? await memory.beforePrompt({ userText: text }) : { text: "", hits: [] };
      await session.prompt(formatPromptWithMemory(text, memoryContext.text));
      if (memoryMode.persistence === "hardwired" || memoryMode.persistence === "hybrid") {
        await memory.afterTurn({
          userText: text,
          assistantText: activeAssistantText.trim(),
          model: isUsableModel(session.model) ? modelLabel(session.model) : undefined,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (error) {
      output.write(`\n[error] ${error instanceof Error ? error.message : String(error)}\n`);
      if (!isUsableModel(session.model)) output.write("Use /model list to inspect configured models, then /model <provider/model> to select one.\n");
    }
    output.write("\n\n");
    return true;
  }

  try {
    if (input.isTTY) {
      while (await handleInput(await rl.question("you> "))) {
        // Continue until /exit or /quit.
      }
    } else {
      for await (const line of rl) {
        output.write(`you> ${line}\n`);
        if (!(await handleInput(line))) break;
      }
    }
  } finally {
    rl.close();
    await memory.dispose?.();
    session.dispose();
  }

  output.write("bye\n");
}

main().catch((error: unknown) => {
  console.error("memchat failed:", error);
  process.exitCode = 1;
});
