#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { argv, exit, stderr, stdout } from "node:process";
import { resolve } from "node:path";
import { validThinkingLevels, type ThinkingLevel } from "./model-selection.js";
import { runWorldImportSkill } from "./world-import/model-runner.js";

const thinkingLevels = new Set<string>(validThinkingLevels);

type CliOptions = {
  input?: string;
  output?: string;
  model?: string;
  reviewerModel?: string;
  thinking?: ThinkingLevel;
  dryRun?: boolean;
  debug: boolean;
  showThinking: boolean;
  showToolUpdates: boolean;
  help?: boolean;
};

function usage(): string {
  return `Usage: memchat-world-import --input <html-dir-or-archive> --output <output-dir> [options]\n\n` +
    `Options:\n` +
    `  --model <provider/model>          Extraction and merge model for the world-import skill\n` +
    `  --reviewer-model <provider/model> Reviewer model passed through to the skill/eval workflow\n` +
    `  --thinking <level>                off|minimal|low|medium|high|xhigh (default: low)\n` +
    `  --dry-run                         Ask the skill to validate setup without importing\n` +
    `  --debug                           Print startup, model, prompt, and tool-call diagnostics to stderr (default: on)\n` +
    `  --show-thinking                   Print model thinking deltas when the provider exposes them (default: on)\n` +
    `  --show-tool-updates               Print verbose tool update payloads, not only start/end (default: off)\n` +
    `  --help                            Show this help\n`;
}

function loadLocalEnv(): void {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;
  for (const rawLine of readFileSync(envPath, "utf-8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const equalsIndex = line.indexOf("=");
    if (equalsIndex === -1) continue;
    const key = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1).trim();
    if (!key || process.env[key] !== undefined) continue;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[key] = value;
  }
}

function truthyEnv(value: string | undefined): boolean {
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

/** Respect an explicit env-var toggle; fall back to a given default when unset. */
function envToggle(key: string, defaultValue: boolean): boolean {
  const raw = process.env[key];
  return raw !== undefined ? truthyEnv(raw) : defaultValue;
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    debug: envToggle("MEMCHAT_WORLD_IMPORT_DEBUG", true),
    showThinking: envToggle("MEMCHAT_WORLD_IMPORT_SHOW_THINKING", true),
    showToolUpdates: envToggle("MEMCHAT_WORLD_IMPORT_SHOW_TOOL_UPDATES", false),
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--debug" || arg === "--verbose") options.debug = true;
    else if (arg === "--show-thinking") {
      options.debug = true;
      options.showThinking = true;
    } else if (arg === "--show-tool-updates") {
      options.debug = true;
      options.showToolUpdates = true;
    } else if (arg === "--input" && next) options.input = args[++i];
    else if (arg === "--output" && next) options.output = args[++i];
    else if (arg === "--model" && next) options.model = args[++i];
    else if (arg === "--reviewer-model" && next) options.reviewerModel = args[++i];
    else if (arg === "--thinking" && next) {
      const value = args[++i];
      if (!thinkingLevels.has(value)) throw new Error(`Invalid --thinking value "${value}".`);
      options.thinking = value as ThinkingLevel;
    } else throw new Error(`Unknown or incomplete option: ${arg}`);
  }
  options.model ??= process.env.MEMCHAT_WORLD_IMPORT_MODEL ?? process.env.MEMCHAT_MODEL;
  options.reviewerModel ??= process.env.MEMCHAT_WORLD_IMPORT_REVIEWER_MODEL;
  return options;
}

async function main(): Promise<void> {
  loadLocalEnv();
  const options = parseArgs(argv.slice(2));
  if (options.help) {
    stdout.write(usage());
    return;
  }
  if (!options.input || !options.output) throw new Error("Both --input and --output are required.\n\n" + usage());
  const result = await runWorldImportSkill({
    input: resolve(options.input),
    outputRoot: resolve(options.output),
    model: options.model,
    reviewerModel: options.reviewerModel,
    thinking: options.thinking,
    dryRun: options.dryRun,
    debug: { enabled: options.debug, showThinking: options.showThinking, showToolUpdates: options.showToolUpdates },
    onText: (text) => stdout.write(text),
    onStatus: (text) => stderr.write(text),
    onThinking: (text) => stderr.write(text),
    onToolEvent: (text) => stderr.write(text),
  });
  if (result.responseText && !result.responseText.endsWith("\n")) stdout.write("\n");
  stderr.write(`[world-import] final output summary: ${JSON.stringify(result.outputSummary)}\n`);
  if (!options.dryRun && result.outputSummary.worldMarkdownFiles === 0) {
    stderr.write("[world-import warning] run completed but no world markdown files were emitted; inspect model output and tool diagnostics.\n");
  }
}

main().catch((error: unknown) => {
  stderr.write(`memchat-world-import failed: ${error instanceof Error ? error.message : String(error)}\n`);
  exit(1);
});
