#!/usr/bin/env node

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
  help?: boolean;
};

function usage(): string {
  return `Usage: memchat-world-import --input <html-dir-or-archive> --output <output-dir> [options]\n\n` +
    `Options:\n` +
    `  --model <provider/model>          Extraction and merge model for the world-import skill\n` +
    `  --reviewer-model <provider/model> Reviewer model passed through to the skill/eval workflow\n` +
    `  --thinking <level>                off|minimal|low|medium|high|xhigh (default: off)\n` +
    `  --dry-run                         Ask the skill to validate setup without importing\n` +
    `  --help                            Show this help\n`;
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--input" && next) options.input = args[++i];
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
    onText: (text) => stdout.write(text),
  });
  if (!result.responseText.endsWith("\n")) stdout.write("\n");
}

main().catch((error: unknown) => {
  stderr.write(`memchat-world-import failed: ${error instanceof Error ? error.message : String(error)}\n`);
  exit(1);
});
