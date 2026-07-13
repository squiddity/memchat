import assert from "node:assert/strict";
import test from "node:test";
import { parseArgs } from "./world-import-cli.js";

test("parseArgs keeps staged as default and reviewer defaults to import model", () => {
  const options = parseArgs(["--input", "./in", "--output", "./out", "--model", "openai/gpt-4o"]);
  assert.equal(options.sessionStrategy, "staged");
  assert.equal(options.reviewerModel, "openai/gpt-4o");
});

test("parseArgs accepts single session strategy", () => {
  const options = parseArgs(["--input", "./in", "--output", "./out", "--session-strategy", "single"]);
  assert.equal(options.sessionStrategy, "single");
});

test("parseArgs accepts an explicit credentials file without changing model configuration", () => {
  const options = parseArgs(["--input", "./in", "--output", "./out", "--auth-file", "../credentials/auth.json"]);
  assert.equal(options.authFile, "../credentials/auth.json");
});

test("parseArgs supports explicit reviewer disable", () => {
  const noReviewer = parseArgs(["--input", "./in", "--output", "./out", "--model", "openai/gpt-4o", "--no-reviewer"]);
  assert.equal(noReviewer.reviewerModel, undefined);

  const reviewerOff = parseArgs(["--input", "./in", "--output", "./out", "--model", "openai/gpt-4o", "--reviewer-model", "off"]);
  assert.equal(reviewerOff.reviewerModel, undefined);
});

test("parseArgs rejects invalid session strategy", () => {
  assert.throws(() => parseArgs(["--input", "./in", "--output", "./out", "--session-strategy", "banana"]), /Invalid --session-strategy value/);
});
