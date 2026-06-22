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
import { createMemoryBackend, isMemoryModeId, memoryModeIds, resolveMemoryMode, type ConversationTurn, type MemoryBackend, type MemoryCompaction, type MemoryDebugEvent, type MemoryFileSnapshot, type MemoryMode, type MemoryModeId, type MemorySynthesis, type MemorySynthesisProvider } from "./memory.js";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
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
  memoryDir?: string;
  memoryDebug: boolean;
  summarizerModel?: string;
};

type ModelResolution = {
  model?: PiModel;
  thinking?: ThinkingLevel;
  error?: string;
  matches?: PiModel[];
};

class InlineSpinner {
  private readonly frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  private timer: NodeJS.Timeout | undefined;
  private frameIndex = 0;
  private active = false;

  constructor(private readonly stream: NodeJS.WriteStream) {}

  start(text = "working...") {
    if (!this.stream.isTTY || this.active) return;
    this.active = true;
    this.frameIndex = 0;

    const render = () => {
      const frame = this.frames[this.frameIndex % this.frames.length];
      this.frameIndex += 1;
      this.stream.write(`\r\x1b[2K${frame} ${text}`);
    };

    render();
    this.timer = setInterval(render, 100);
  }

  stop() {
    if (!this.active) return;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.active = false;
    this.stream.write("\r\x1b[2K");
  }
}

type MemchatPackageJson = {
  memchat?: {
    /** npm package names or local paths containing pi package resources. */
    piPackages?: string[];
  };
};

const baseChatSystemPrompt = `You are Memchat, a warm, internally consistent chat and fiction partner.

Memchat may provide a "Relevant remembered context" block before a user message. Treat that block as retrieved memory, prefer it over invention, and use its citations when helpful.
When the block separates current-session details from persisted remembered context, prefer current-session details for the active conversation. Treat possible conflicts or retcons as a signal to preserve the latest session state while acknowledging uncertainty when useful.
If no memory context is provided, only rely on the active session context.

Conversation priorities:
- Be conversational and concise by default.
- For fiction, invention is allowed, but maintain consistency with details already established in this session.
- If the user asks for something that depends on missing memory, ask or state uncertainty instead of fabricating continuity.
- Do not overstate memory confidence; distinguish retrieved context from guesses.`;

const memoryDebugSystemPrompt = `Memory debug mode is enabled. Memchat prints memory instrumentation automatically, including hardwired recall, injected context, and qmd/Bash(qmd:*) tool start/end events. Do not emit extra freeform "Memory retrieval" notes unless the user explicitly asks for them; keep normal answers separate from debug instrumentation.`;

const memoryFlushTimeoutMs = 10_000;

const qmdSkillRetrievalStrategyPrompt = `Qmd memory retrieval strategy:
- Treat .memchat/memory markdown as the synthesized memory layer and .memchat/sessions JSONL as the raw transcript/audit layer.
- When using qmd or Bash(qmd:*) for memory retrieval, search synthesized memory first: .memchat/memory/facts.md, .memchat/memory/state.md, .memchat/memory/conflicts.md, and .memchat/memory/summaries/*.md.
- Only do an additional transcript/session search when synthesized memory has no relevant hits, hits are weak or ambiguous, a conflict/retcon needs source verification, the user asks for exact wording/provenance, or answering safely requires inspecting the raw turn.
- Prefer current-session details when memchat injects them alongside older persisted memory.
- Prefer concise answers grounded in synthesized memory; cite transcript only when you actually consulted it or need audit-level evidence.`;

const memorySynthesisSystemPrompt = `You are Memchat's background memory synthesizer. Convert chat turns into durable, concise memory notes for future retrieval.

Rules:
- Do not copy the transcript. Synthesize only reusable continuity.
- Prefer concrete facts, state changes, unresolved hooks, user preferences, entity attributes, locations, relationships, inventory, and explicit retcons.
- Distinguish stable facts from current state. Facts should remain true until retconned. State can change over time.
- Record contradictions, uncertainty, or intentional retcons as conflicts.
- Omit routine banter and low-value details.
- Preserve names and invented details exactly.
- Return only strict JSON with this shape:
{"summaryBullets":["..."],"facts":["..."],"state":["..."],"conflicts":["..."]}`;

const memoryCompactionSystemPrompt = `You are Memchat's end-of-session memory compactor. Restate markdown memory so it is concise, searchable, and useful for future two-stage retrieval.

Rules:
- Keep source citations already present when possible.
- Deduplicate repeated facts and state updates.
- In state.md, restate the current state, not the full change log.
- In summaries, keep a compact chronological session arc and important changes.
- Keep conflicts/retcons explicit.
- Do not invent details not supported by supplied memory.
- Return only strict JSON with this shape:
{"summaryMarkdown":"# Summary YYYY-MM-DD\\n...","factsMarkdown":"# Facts\\n...","stateMarkdown":"# Current State\\n...","conflictsMarkdown":"# Conflicts and Retcons\\n..."}`;

function chatSystemPrompt(memoryDebug: boolean, includeQmdSkillStrategy: boolean): string {
  const parts = [baseChatSystemPrompt];
  if (includeQmdSkillStrategy) parts.push(qmdSkillRetrievalStrategyPrompt);
  if (memoryDebug) parts.push(memoryDebugSystemPrompt);
  return parts.join("\n\n");
}

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

function truthyEnv(value: string | undefined): boolean {
  return value === "1" || value === "true" || value === "yes" || value === "on";
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
    } else if (arg === "--memory-dir" && args[i + 1]) {
      options.memoryDir = args[++i];
    } else if (arg === "--summarizer-model" && args[i + 1]) {
      options.summarizerModel = args[++i];
    } else if (arg === "--memory-debug") {
      options.memoryDebug = true;
    } else if (arg === "--no-memory-debug") {
      options.memoryDebug = false;
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
  options.memoryDir ??= process.env.MEMCHAT_MEMORY_DIR;
  options.summarizerModel ??= process.env.MEMCHAT_SUMMARIZER_MODEL;
  options.memoryDebug ??= truthyEnv(process.env.MEMCHAT_MEMORY_DEBUG);
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

function printBanner(packageSources: PackageSource[], model: PiModel | undefined, thinking: string, memory: MemoryBackend, memoryMode: MemoryMode, memoryDebug: boolean, summarizerLabel?: string) {
  output.write("\nmemchat hello-world\n");
  output.write("Type a message and press Enter. Commands: /help, /model, /memory, /plugins, /exit\n");
  output.write(`Memory: ${memoryMode.id} (backend: ${memory.id}, persistence: ${memoryMode.persistence}, retrieval: ${memoryMode.retrieval})\n`);
  output.write(`Memory debug: ${memoryDebug ? "on" : "off"}\n`);
  if (memoryMode.allowSkillTools) output.write("Tools: built-in pi tools enabled so memory skills can invoke declared tools such as Bash(qmd:*).\n");
  output.write(`Model: ${isUsableModel(model) ? modelLabel(model) : "none selected"} (thinking: ${thinking})\n`);
  if (summarizerLabel) output.write(`Summarizer model: ${summarizerLabel}\n`);
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
  if (status.work) {
    output.write(`Memory work: pending=${status.work.pending}, completed=${status.work.completed}, failed=${status.work.failed}, timedOut=${status.work.timedOut}\n`);
    for (const failure of status.work.failures) output.write(`- memory work failure: ${failure}\n`);
  }
  for (const note of status.notes ?? []) output.write(`- ${note}\n`);
}

async function flushMemory(memory: MemoryBackend, reason: "recall" | "index" | "new-session" | "shutdown"): Promise<void> {
  if (!memory.flush) return;
  const result = await memory.flush({ reason, timeoutMs: memoryFlushTimeoutMs });
  if (result.pending > 0 || result.failed > 0 || result.timedOut > 0) {
    output.write(
      `[memory warning] ${reason} flush incomplete: pending=${result.pending}, failed=${result.failed}, timedOut=${result.timedOut}\n`,
    );
    for (const failure of result.failures) output.write(`[memory warning] ${failure}\n`);
  }
}

function printMemoryBackends() {
  output.write(`Memory modes: ${memoryModeIds.join(", ")}\n`);
}

function italic(text: string): string {
  return output.isTTY ? `\x1b[3m${text}\x1b[23m` : `_${text}_`;
}

function memoryDebugStyle(text: string): string {
  return output.isTTY ? `\x1b[3m\x1b[36m${text}\x1b[39m\x1b[23m` : `_${text}_`;
}

function printMemoryDebugLine(text: string): void {
  output.write(`${memoryDebugStyle(text)}\n`);
}

function printMemoryDebugEvent(event: MemoryDebugEvent): void {
  printMemoryDebugLine(`[memory ${event.backend}/${event.operation}] ${event.detail}`);
}

function printInjectedMemoryContext(context: string): void {
  if (!context.trim()) return;
  printMemoryDebugLine(`[memory injected-context]\n${context}`);
}

function isQmdToolCall(toolName: string, args: unknown): boolean {
  if (toolName === "qmd") return true;
  if (toolName !== "bash") return false;
  if (!args || typeof args !== "object" || !("command" in args)) return false;
  const command = String((args as { command?: unknown }).command ?? "").trim();
  return /(^|[;&|()\s])(?:\.\/node_modules\/\.bin\/)?qmd(?:\s|$)/.test(command);
}

function summarizeToolArgs(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  if ("command" in args) return String((args as { command?: unknown }).command ?? "");
  return JSON.stringify(args);
}

function looksLikeMemoryNoteStart(text: string): boolean {
  return /^\s*_?Memory (retrieval|write|update):/i.test(text);
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

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) throw new Error("model did not return JSON");
    return JSON.parse(trimmed.slice(start, end + 1));
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()) : [];
}

function parseMemorySynthesis(text: string): MemorySynthesis {
  const parsed = extractJsonObject(text) as Partial<Record<keyof MemorySynthesis, unknown>>;
  return {
    summaryBullets: stringArray(parsed.summaryBullets),
    facts: stringArray(parsed.facts),
    state: stringArray(parsed.state),
    conflicts: stringArray(parsed.conflicts),
  };
}

function parseMemoryCompaction(text: string): MemoryCompaction {
  const parsed = extractJsonObject(text) as Partial<Record<keyof MemoryCompaction, unknown>>;
  return {
    summaryMarkdown: typeof parsed.summaryMarkdown === "string" ? parsed.summaryMarkdown : "",
    factsMarkdown: typeof parsed.factsMarkdown === "string" ? parsed.factsMarkdown : undefined,
    stateMarkdown: typeof parsed.stateMarkdown === "string" ? parsed.stateMarkdown : undefined,
    conflictsMarkdown: typeof parsed.conflictsMarkdown === "string" ? parsed.conflictsMarkdown : undefined,
  };
}

function renderSynthesisPrompt(turn: ConversationTurn, memory: MemoryFileSnapshot, sessionId: string, transcriptSource: string): string {
  return JSON.stringify({
    task: "synthesize latest turn into memory artifacts",
    sessionId,
    transcriptSource,
    currentMemory: memory,
    latestTurn: turn,
  });
}

function renderCompactionPrompt(sessionId: string, transcriptSource: string, memory: MemoryFileSnapshot, sessionSummary: string): string {
  return JSON.stringify({
    task: "compact and restate end-of-session memory markdown",
    sessionId,
    transcriptSource,
    currentMemory: memory,
    sessionSummary,
  });
}

function printHelp() {
  output.write(
    `\nCommands:\n` +
      `  /help                Show this help\n` +
      `  /new                 Start a fresh chat/memory session without restarting\n` +
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
      `Startup options/env: --model, --provider, --thinking, --memory, --memory-dir, --summarizer-model, --memory-debug, --list-models; MEMCHAT_MODEL, MEMCHAT_PROVIDER, MEMCHAT_THINKING, MEMCHAT_MEMORY, MEMCHAT_MEMORY_DIR, MEMCHAT_SUMMARIZER_MODEL, MEMCHAT_MEMORY_DEBUG.\n` +
      `Configure local pi packages with package.json memchat.piPackages or MEMCHAT_PI_PACKAGES.\n\n`,
  );
}

async function main() {
  loadLocalEnv();
  const cliOptions = parseCliOptions(argv.slice(2));
  const packageSources = getLocalPiPackageSources();
  const memoryMode = resolveMemoryMode(cliOptions.memory);
  let spinner: InlineSpinner | undefined;
  let memory: MemoryBackend;
  let synthesisProvider: MemorySynthesisProvider | undefined;
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
    systemPrompt: chatSystemPrompt(cliOptions.memoryDebug, memoryMode.skills.includes("qmd")),
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

  let { session } = await createAgentSession({
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
    session.dispose();
    return;
  }

  let summarizerSession: AgentSession | undefined;
  const summarizerLabel = cliOptions.summarizerModel ?? "active session model";

  if (memoryMode.backend === "qmd") {
    const summarizerResourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager,
      additionalExtensionPaths: [resolve(cwd, "extensions/lemonade-provider.ts")],
      noExtensions: true,
      noContextFiles: true,
      systemPrompt: memorySynthesisSystemPrompt,
    });
    await summarizerResourceLoader.reload();
    ({ session: summarizerSession } = await createAgentSession({
      cwd,
      agentDir,
      authStorage,
      modelRegistry,
      resourceLoader: summarizerResourceLoader,
      settingsManager,
      sessionManager: SessionManager.inMemory(cwd),
      noTools: "builtin" as const,
      thinkingLevel: "off",
    }));

    if (cliOptions.summarizerModel) {
      const resolved = resolveModel(cliOptions.summarizerModel, summarizerSession.modelRegistry, cliOptions.provider);
      if (resolved.error || !resolved.model) output.write(`[summarizer warning] ${resolved.error ?? "Model not found."}\n`);
      else {
        try {
          await summarizerSession.setModel(resolved.model);
        } catch (error) {
          output.write(`[summarizer warning] Could not select ${modelLabel(resolved.model)}: ${error instanceof Error ? error.message : String(error)}\n`);
        }
      }
    }

    let summarizerSystemPrompt = memorySynthesisSystemPrompt;
    const promptSummarizer = async (prompt: string, systemPrompt = memorySynthesisSystemPrompt): Promise<string> => {
      if (!summarizerSession) throw new Error("summarizer session is not available");
      if (systemPrompt !== summarizerSystemPrompt) {
        summarizerSession.dispose();
        const loader = new DefaultResourceLoader({
          cwd,
          agentDir,
          settingsManager,
          additionalExtensionPaths: [resolve(cwd, "extensions/lemonade-provider.ts")],
          noExtensions: true,
          noContextFiles: true,
          systemPrompt,
        });
        await loader.reload();
        ({ session: summarizerSession } = await createAgentSession({ cwd, agentDir, authStorage, modelRegistry, resourceLoader: loader, settingsManager, sessionManager: SessionManager.inMemory(cwd), noTools: "builtin" as const, thinkingLevel: "off" }));
        summarizerSystemPrompt = systemPrompt;
        if (cliOptions.summarizerModel) {
          const resolved = resolveModel(cliOptions.summarizerModel, summarizerSession.modelRegistry, cliOptions.provider);
          if (resolved.model) await summarizerSession.setModel(resolved.model);
        }
      }
      if (!cliOptions.summarizerModel && isUsableModel(session.model)) await summarizerSession.setModel(session.model);
      if (!isUsableModel(summarizerSession.model)) throw new Error("no summarizer model selected");
      let text = "";
      const unsubscribe = summarizerSession.subscribe((event) => {
        if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") text += event.assistantMessageEvent.delta;
      });
      try {
        await summarizerSession.prompt(prompt);
        return text;
      } finally {
        unsubscribe();
      }
    };

    synthesisProvider = {
      label: cliOptions.summarizerModel ?? "active session model",
      async synthesizeTurn({ turn, sessionId, transcriptSource, memory }) {
        const response = await promptSummarizer(renderSynthesisPrompt(turn, memory, sessionId, transcriptSource));
        return parseMemorySynthesis(response);
      },
      async compactSession({ sessionId, transcriptSource, memory, sessionSummary }) {
        const response = await promptSummarizer(renderCompactionPrompt(sessionId, transcriptSource, memory, sessionSummary), memoryCompactionSystemPrompt);
        return parseMemoryCompaction(response);
      },
    };
  }

  function createConfiguredMemory(): MemoryBackend {
    return createMemoryBackend({
      id: memoryMode.backend,
      cwd,
      root: cliOptions.memoryDir,
      synthesisProvider,
      onDebug: cliOptions.memoryDebug ? (event) => {
        spinner?.stop();
        printMemoryDebugEvent(event);
      } : undefined,
    });
  }
  memory = createConfiguredMemory();

  const rl = readline.createInterface({ input, output });
  spinner = new InlineSpinner(output);
  let activeAssistantText = "";
  let activeAssistantStarted = false;
  let activeAssistantPrefixPrinted = false;
  const memoryToolCallIds = new Set<string>();

  let unsubscribeSession: (() => void) | undefined;

  function attachSessionEvents(currentSession: AgentSession): void {
    unsubscribeSession?.();
    unsubscribeSession = currentSession.subscribe((event) => {
      if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
        const delta = event.assistantMessageEvent.delta;
        if (!activeAssistantStarted) {
          activeAssistantStarted = true;
          spinner?.stop();
        }
        if (!activeAssistantPrefixPrinted && !looksLikeMemoryNoteStart(delta)) {
          activeAssistantPrefixPrinted = true;
          output.write("memchat> ");
        }
        activeAssistantText += delta;
        output.write(delta);
      }
      if (cliOptions.memoryDebug && event.type === "tool_execution_start" && isQmdToolCall(event.toolName, event.args)) {
        memoryToolCallIds.add(event.toolCallId);
        spinner?.stop();
        printMemoryDebugLine(`[memory tool/start] ${event.toolName}: ${summarizeToolArgs(event.args)}`);
      }
      if (cliOptions.memoryDebug && event.type === "tool_execution_end" && memoryToolCallIds.has(event.toolCallId)) {
        memoryToolCallIds.delete(event.toolCallId);
        spinner?.stop();
        printMemoryDebugLine(`[memory tool/end] ${event.toolName}: ${event.isError ? "error" : "ok"}`);
      }
    });
  }

  async function startNewSession(): Promise<void> {
    const previousModel = session.model;
    const previousThinking = session.thinkingLevel;
    unsubscribeSession?.();
    unsubscribeSession = undefined;
    session.dispose();
    await flushMemory(memory, "new-session");
    await memory.dispose?.();
    memory = createConfiguredMemory();
    ({ session } = await createAgentSession({
      cwd,
      agentDir,
      authStorage,
      modelRegistry,
      resourceLoader,
      settingsManager,
      sessionManager: SessionManager.inMemory(cwd),
      ...(memoryMode.allowSkillTools ? {} : { noTools: "builtin" as const }),
      thinkingLevel: previousThinking,
    }));
    if (isUsableModel(previousModel)) {
      try {
        await session.setModel(previousModel);
      } catch (error) {
        output.write(`[model warning] Could not preserve ${modelLabel(previousModel)} in new session: ${error instanceof Error ? error.message : String(error)}\n`);
      }
    }
    session.setThinkingLevel(previousThinking);
    activeAssistantText = "";
    activeAssistantStarted = false;
    activeAssistantPrefixPrinted = false;
    memoryToolCallIds.clear();
    attachSessionEvents(session);
    const status = await memory.status();
    output.write(`Started new session${status.sessionId ? ` (${status.sessionId})` : ""}.\n`);
  }

  attachSessionEvents(session);
  printBanner(packageSources, session.model, session.thinkingLevel, memory, memoryMode, cliOptions.memoryDebug, memoryMode.backend === "qmd" ? summarizerLabel : undefined);

  async function handleInput(line: string): Promise<boolean> {
    const text = line.trim();
    if (!text) return true;

    if (text === "/exit" || text === "/quit") return false;
    if (text === "/help") {
      printHelp();
      return true;
    }
    if (text === "/new") {
      await startNewSession();
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
      await flushMemory(memory, "recall");
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
      await flushMemory(memory, "index");
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

    activeAssistantText = "";
    activeAssistantStarted = false;
    activeAssistantPrefixPrinted = false;
    spinner?.start("working...");
    try {
      const memoryContext = memoryMode.retrieval === "hardwired" || memoryMode.retrieval === "hybrid" ? await memory.beforePrompt({ userText: text }) : { text: "", hits: [] };
      if (cliOptions.memoryDebug) printInjectedMemoryContext(memoryContext.text);
      if (cliOptions.memoryDebug) printMemoryDebugLine("[model] working...");
      if (!activeAssistantStarted) spinner?.start("working...");
      await session.prompt(formatPromptWithMemory(text, memoryContext.text));
      spinner?.stop();
      if (cliOptions.memoryDebug && activeAssistantStarted) output.write("\n");
      if (memoryMode.persistence === "hardwired" || memoryMode.persistence === "hybrid") {
        await memory.afterTurn({
          userText: text,
          assistantText: activeAssistantText.trim(),
          model: isUsableModel(session.model) ? modelLabel(session.model) : undefined,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (error) {
      spinner?.stop();
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
    spinner?.stop();
    rl.close();
    unsubscribeSession?.();
    await flushMemory(memory, "shutdown");
    await memory.dispose?.();
    summarizerSession?.dispose();
    session.dispose();
  }

  output.write("bye\n");
}

main().catch((error: unknown) => {
  console.error("memchat failed:", error);
  process.exitCode = 1;
});
