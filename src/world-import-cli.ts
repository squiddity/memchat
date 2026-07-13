#!/usr/bin/env node

import { argv, exit, stderr, stdout } from "node:process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { envToggle, loadLocalEnv } from "./local-env.js";
import { resolveReviewerModel, resolveShowThinking, styleThinkingText } from "./world-import-cli-format.js";
import { validThinkingLevels, type ThinkingLevel } from "./model-selection.js";
import { runWorldImportSkill, type WorldImportSessionStrategy } from "./world-import/model-runner.js";

const thinkingLevels = new Set<string>(validThinkingLevels);
const sessionStrategies = new Set<WorldImportSessionStrategy>(["single", "staged"]);

export type CliOptions = {
  input?: string;
  output?: string;
  model?: string;
  reviewerModel?: string;
  authFile?: string;
  thinking?: ThinkingLevel;
  dryRun?: boolean;
  debug: boolean;
  showThinking: boolean;
  showToolUpdates: boolean;
  sessionStrategy: WorldImportSessionStrategy;
  reviewerDisabled: boolean;
  help?: boolean;
};

export function usage(): string {
  return `Usage: memchat-world-import --input <html-dir-or-archive> --output <output-dir> [options]\n\n` +
    `Options:\n` +
    `  --model <provider/model>          Extraction and merge model for the world-import skill\n` +
    `  --reviewer-model <provider/model> Reviewer model passed through to the skill/eval workflow (defaults to --model)\n` +
    `  --auth-file <path>               Opt into credentials from this auth.json (default: .memchat/pi/auth.json)\n` +
    `  --no-reviewer                     Disable reviewer-model scoring explicitly\n` +
    `  --session-strategy <single|staged> Run staged extract/merge/review sessions or one full session (default: staged)\n` +
    `  --thinking <level>                off|minimal|low|medium|high|xhigh (default: low)\n` +
    `  --dry-run                         Ask the skill to validate setup without importing\n` +
    `  --debug                           Print startup, model, prompt, and tool-call diagnostics to stderr (default: on)\n` +
    `  --show-thinking                   Print model thinking deltas when the provider exposes them (default: on)\n` +
    `  --no-show-thinking                Suppress printed model thinking deltas\n` +
    `  --show-tool-updates               Print verbose tool update payloads, not only start/end (default: off)\n` +
    `  --help                            Show this help\n`;
}

export function parseArgs(args: string[]): CliOptions {
  const envShowThinking = envToggle("MEMCHAT_WORLD_IMPORT_SHOW_THINKING", true);
  let explicitShowThinking = false;
  let explicitHideThinking = false;
  const options: CliOptions = {
    debug: envToggle("MEMCHAT_WORLD_IMPORT_DEBUG", true),
    showThinking: envShowThinking,
    showToolUpdates: envToggle("MEMCHAT_WORLD_IMPORT_SHOW_TOOL_UPDATES", false),
    sessionStrategy: "staged",
    reviewerDisabled: false,
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--debug" || arg === "--verbose") options.debug = true;
    else if (arg === "--show-thinking") {
      options.debug = true;
      explicitShowThinking = true;
      explicitHideThinking = false;
    } else if (arg === "--no-show-thinking") {
      explicitHideThinking = true;
      explicitShowThinking = false;
    } else if (arg === "--show-tool-updates") {
      options.debug = true;
      options.showToolUpdates = true;
    } else if (arg === "--no-reviewer") {
      options.reviewerDisabled = true;
    } else if (arg === "--input" && next) options.input = args[++i];
    else if (arg === "--output" && next) options.output = args[++i];
    else if (arg === "--model" && next) options.model = args[++i];
    else if (arg === "--reviewer-model" && next) options.reviewerModel = args[++i];
    else if (arg === "--auth-file" && next) options.authFile = args[++i];
    else if (arg === "--session-strategy" && next) {
      const value = args[++i] as WorldImportSessionStrategy;
      if (!sessionStrategies.has(value)) throw new Error(`Invalid --session-strategy value "${value}".`);
      options.sessionStrategy = value;
    } else if (arg === "--thinking" && next) {
      const value = args[++i];
      if (!thinkingLevels.has(value)) throw new Error(`Invalid --thinking value "${value}".`);
      options.thinking = value as ThinkingLevel;
    } else throw new Error(`Unknown or incomplete option: ${arg}`);
  }
  options.model ??= process.env.MEMCHAT_WORLD_IMPORT_MODEL ?? process.env.MEMCHAT_MODEL;
  options.authFile ??= process.env.MEMCHAT_PI_AUTH_FILE;
  options.reviewerModel = resolveReviewerModel({
    explicitReviewerModel: options.reviewerModel ?? process.env.MEMCHAT_WORLD_IMPORT_REVIEWER_MODEL,
    importModel: options.model,
    disabled: options.reviewerDisabled,
  });
  options.showThinking = resolveShowThinking({ explicitShow: explicitShowThinking, explicitHide: explicitHideThinking, envDefault: envShowThinking });
  return options;
}

export async function main(args = argv.slice(2)): Promise<void> {
  loadLocalEnv();
  const options = parseArgs(args);
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
    authFile: options.authFile,
    thinking: options.thinking,
    dryRun: options.dryRun,
    sessionStrategy: options.sessionStrategy,
    debug: { enabled: options.debug, showThinking: options.showThinking, showToolUpdates: options.showToolUpdates },
    onText: (text) => stdout.write(text),
    onStatus: (text) => stderr.write(text),
    onThinking: (text) => stderr.write(styleThinkingText(text, stderr.isTTY)),
    onToolEvent: (text) => stderr.write(text),
  });
  if (result.responseText && !result.responseText.endsWith("\n")) stdout.write("\n");
  stderr.write(`[world-import] session strategy: ${result.sessionStrategy}\n`);
  stderr.write(`[world-import] stages: ${result.stages.map((stage) => stage.stage).join(" -> ")}\n`);
  stderr.write(`[world-import] final output summary: ${JSON.stringify(result.outputSummary)}\n`);
  if (!options.dryRun && result.outputSummary.worldMarkdownFiles === 0) {
    stderr.write("[world-import warning] run completed but no world markdown files were emitted; inspect model output and tool diagnostics.\n");
  }
}

if (argv[1] && import.meta.url === pathToFileURL(argv[1]).href) {
  main().catch((error: unknown) => {
    stderr.write(`memchat-world-import failed: ${error instanceof Error ? error.message : String(error)}\n`);
    exit(1);
  });
}
