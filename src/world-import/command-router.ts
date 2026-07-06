#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { argv, exit, stdin, stdout, stderr } from "node:process";
import { envToggle, loadLocalEnv } from "../local-env.js";
import { resolveReviewerModel, resolveShowThinking, styleThinkingText } from "../world-import-cli-format.js";
import { emitWorldLibrary } from "./emit.js";
import { lintWorldImport, runReviewerModelEvaluation } from "./eval.js";
import {
  buildCoveragePlan,
  buildRepairSummary,
  emitLintRepairLoop,
  parseMaxChars,
  parseMaxIterations,
  parsePlannedIds,
  parseWriteMode,
  patchMerge,
  quoteRef,
  readArtifactFromFileOrStdin,
  readPatchFromFileOrStdin,
  resolveRef,
  selectorFromOptions,
  validateArtifact,
  writeArtifact,
  writeRepairSummaryFile,
} from "./helper-tools.js";
import { normalizeSources } from "./normalize.js";
import { readSlice } from "./spans.js";
import { readManifest, readNormalizedUnit, validateStageEnvelope, writeExtractionStage, writeMergeStage } from "./staging.js";
import type { StageEnvelope } from "./types.js";

function usage(): string {
  return `world import helper commands:\n\n` +
    `  normalize --input <path> --output <dir>\n` +
    `  list-units --output <dir>\n` +
    `  read-unit --output <dir> --unit <unit-id>\n` +
    `  read-slice --output <dir> --unit <unit-id> --start <anchor> --end <anchor>\n` +
    `  resolve-ref --output <dir> (--unit <unit-id>|--order <n>|--entry-path <text>|--title <text>) --start <anchor> --end <anchor>\n` +
    `  quote-ref --output <dir> (--unit <unit-id>|--order <n>|--entry-path <text>|--title <text>) --start <anchor> --end <anchor> [--as-ref] [--max-chars <n>]\n` +
    `  validate-artifact --output <dir> [--file artifact.json] [--planned-ids a,b] [--allow-empty-quotes]\n` +
    `  write-artifact --output <dir> [--mode add|replace|upsert] [--file artifact.json] [--planned-ids a,b] [--allow-empty-quotes]\n` +
    `  patch-merge --output <dir> [--file patch.json]\n` +
    `  coverage-plan --output <dir>\n` +
    `  repair-summary --output <dir> [--format json|markdown] [--write]\n` +
    `  emit-lint-repair-loop --output <dir> [--max-iterations <n>]\n` +
    `  write-extraction --output <dir> --unit <unit-id> < stage.json\n` +
    `  write-merge --output <dir> < merged-stage.json\n` +
    `  validate-stage --kind extraction|merge --file <stage.json>\n` +
    `  emit --output <dir>\n` +
    `  lint --output <dir>\n` +
    `  eval --output <dir> [--reviewer-model <provider/model>] [--debug] [--show-thinking] [--no-show-thinking] [--show-tool-updates]  # reviewer model defaults to MEMCHAT_WORLD_IMPORT_REVIEWER_MODEL, then MEMCHAT_WORLD_IMPORT_MODEL, then MEMCHAT_MODEL\n`;
}

function parseArgs(args: string[]): { command?: string; options: Record<string, string | true> } {
  const [command, ...rest] = args;
  const options: Record<string, string | true> = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (!arg.startsWith("--")) throw new Error(`Unexpected argument: ${arg}`);
    const key = arg.slice(2);
    const next = rest[i + 1];
    if (!next || next.startsWith("--")) options[key] = true;
    else options[key] = rest[++i];
  }
  return { command, options };
}

function requireString(options: Record<string, string | true>, key: string): string {
  const value = options[key];
  if (typeof value !== "string" || value.length === 0) throw new Error(`Missing --${key}`);
  return value;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf-8");
}

type HelperDebugOptions = {
  enabled: boolean;
  showThinking: boolean;
  showToolUpdates: boolean;
};

function debugOptions(options: Record<string, string | true>): HelperDebugOptions {
  const envShowThinking = envToggle("MEMCHAT_WORLD_IMPORT_SHOW_THINKING", true);
  return {
    enabled: options.debug === true || options.verbose === true || envToggle("MEMCHAT_WORLD_IMPORT_DEBUG", true),
    showThinking: resolveShowThinking({ explicitShow: options["show-thinking"] === true, explicitHide: options["no-show-thinking"] === true, envDefault: envShowThinking }),
    showToolUpdates: options["show-tool-updates"] === true || envToggle("MEMCHAT_WORLD_IMPORT_SHOW_TOOL_UPDATES", false),
  };
}

async function main(): Promise<void> {
  loadLocalEnv();
  const { command, options } = parseArgs(argv.slice(2));
  if (!command || command === "help" || options.help) {
    stdout.write(usage());
    return;
  }

  if (command === "normalize") {
    const manifest = await normalizeSources({ input: requireString(options, "input"), outputRoot: requireString(options, "output") });
    stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
    return;
  }

  if (command === "list-units") {
    const manifest = await readManifest(requireString(options, "output"));
    stdout.write(`${JSON.stringify(manifest.units, null, 2)}\n`);
    return;
  }

  if (command === "read-unit") {
    const unit = await readNormalizedUnit(requireString(options, "output"), requireString(options, "unit"));
    stdout.write(`${unit.content}\n`);
    return;
  }

  if (command === "read-slice") {
    const unit = await readNormalizedUnit(requireString(options, "output"), requireString(options, "unit"));
    stdout.write(`${readSlice(unit, requireString(options, "start"), requireString(options, "end"))}\n`);
    return;
  }

  if (command === "resolve-ref") {
    const ref = await resolveRef({
      outputRoot: requireString(options, "output"),
      ...selectorFromOptions(options),
      start: requireString(options, "start"),
      end: requireString(options, "end"),
    });
    stdout.write(`${JSON.stringify(ref, null, 2)}\n`);
    return;
  }

  if (command === "quote-ref") {
    const ref = await quoteRef({
      outputRoot: requireString(options, "output"),
      ...selectorFromOptions(options),
      start: requireString(options, "start"),
      end: requireString(options, "end"),
      maxChars: parseMaxChars(options["max-chars"]),
      joiner: typeof options.joiner === "string" ? options.joiner : undefined,
      plain: options.plain === true,
      asRef: options["as-ref"] === true,
    });
    const output = options["as-ref"] === true
      ? { sourceId: ref.sourceId, unitId: ref.unitId, startAnchor: ref.startAnchor, endAnchor: ref.endAnchor, quote: ref.quote }
      : ref;
    stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    return;
  }

  if (command === "validate-artifact") {
    const artifactFile = typeof options.file === "string" ? options.file : undefined;
    const artifact = await readArtifactFromFileOrStdin(artifactFile, artifactFile ? "" : await readStdin());
    const result = await validateArtifact({
      outputRoot: requireString(options, "output"),
      artifact,
      allowEmptyQuotes: options["allow-empty-quotes"] === true,
      plannedIds: parsePlannedIds(options["planned-ids"]),
    });
    stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.passed) exit(1);
    return;
  }

  if (command === "write-artifact") {
    const artifactFile = typeof options.file === "string" ? options.file : undefined;
    const result = await writeArtifact({
      outputRoot: requireString(options, "output"),
      artifact: await readArtifactFromFileOrStdin(artifactFile, artifactFile ? "" : await readStdin()),
      mode: parseWriteMode(options.mode),
      validate: options["no-validate"] !== true,
      allowEmptyQuotes: options["allow-empty-quotes"] === true,
      plannedIds: parsePlannedIds(options["planned-ids"]),
    });
    stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.wrote) exit(1);
    return;
  }

  if (command === "patch-merge") {
    const patchFile = typeof options.file === "string" ? options.file : undefined;
    const result = await patchMerge(requireString(options, "output"), await readPatchFromFileOrStdin(patchFile, patchFile ? "" : await readStdin()));
    stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.patched) exit(1);
    return;
  }

  if (command === "coverage-plan") {
    const result = await buildCoveragePlan(requireString(options, "output"));
    stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "repair-summary") {
    const format = options.format === "json" ? "json" : "markdown";
    const result = await buildRepairSummary(requireString(options, "output"), format);
    if (format === "markdown" && typeof result === "string" && options.write === true) {
      const path = await writeRepairSummaryFile(requireString(options, "output"), result);
      stdout.write(`${JSON.stringify({ path }, null, 2)}\n`);
    } else {
      stdout.write(typeof result === "string" ? result : `${JSON.stringify(result, null, 2)}\n`);
    }
    return;
  }

  if (command === "emit-lint-repair-loop") {
    const result = await emitLintRepairLoop(requireString(options, "output"), parseMaxIterations(options["max-iterations"]));
    stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.passed) exit(1);
    return;
  }

  if (command === "write-extraction") {
    const outputRoot = requireString(options, "output");
    const unitId = requireString(options, "unit");
    const stage = JSON.parse(await readStdin()) as StageEnvelope;
    stage.kind = "extraction";
    stage.unitId ??= unitId;
    await writeExtractionStage(outputRoot, stage);
    stdout.write(`wrote extraction stage for ${stage.unitId}\n`);
    return;
  }

  if (command === "write-merge") {
    const stage = JSON.parse(await readStdin()) as StageEnvelope;
    stage.kind = "merge";
    await writeMergeStage(requireString(options, "output"), stage);
    stdout.write("wrote merge stage\n");
    return;
  }

  if (command === "validate-stage") {
    const kind = requireString(options, "kind");
    const stage = JSON.parse(await readFile(requireString(options, "file"), "utf-8")) as StageEnvelope;
    validateStageEnvelope(stage, { requireCandidates: kind === "extraction", requireArtifacts: kind === "merge" });
    stdout.write("stage ok\n");
    return;
  }

  if (command === "emit") {
    const written = await emitWorldLibrary(requireString(options, "output"));
    stdout.write(`${JSON.stringify({ written }, null, 2)}\n`);
    return;
  }

  if (command === "lint") {
    const result = await lintWorldImport(requireString(options, "output"));
    stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.passed) exit(1);
    return;
  }

  if (command === "eval") {
    const reviewerModel = resolveReviewerModel({
      explicitReviewerModel: typeof options["reviewer-model"] === "string"
        ? options["reviewer-model"]
        : process.env.MEMCHAT_WORLD_IMPORT_REVIEWER_MODEL,
      importModel: process.env.MEMCHAT_WORLD_IMPORT_MODEL ?? process.env.MEMCHAT_MODEL,
    });
    const debug = debugOptions(options);
    const result = await runReviewerModelEvaluation({
      outputRoot: requireString(options, "output"),
      reviewerModel,
      debug,
      onStatus: (text) => stderr.write(text),
      onThinking: (text) => stderr.write(styleThinkingText(text, stderr.isTTY)),
      onToolEvent: (text) => stderr.write(text),
    });
    stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  throw new Error(`Unknown command: ${command}\n\n${usage()}`);
}

main().catch((error: unknown) => {
  stderr.write(`world-import helper failed: ${error instanceof Error ? error.message : String(error)}\n`);
  exit(1);
});
