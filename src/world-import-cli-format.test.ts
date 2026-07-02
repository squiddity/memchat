import assert from "node:assert/strict";
import test from "node:test";
import { resolveShowThinking, styleThinkingText } from "./world-import-cli-format.js";

test("styleThinkingText adds italic cyan ANSI styling for TTY output", () => {
  assert.equal(styleThinkingText("thinking", true), "\x1b[3m\x1b[36mthinking\x1b[39m\x1b[23m");
  assert.equal(styleThinkingText("thinking", false), "thinking");
});

test("resolveShowThinking honors explicit CLI overrides over env defaults", () => {
  assert.equal(resolveShowThinking({ explicitShow: false, explicitHide: false, envDefault: true }), true);
  assert.equal(resolveShowThinking({ explicitShow: false, explicitHide: true, envDefault: true }), false);
  assert.equal(resolveShowThinking({ explicitShow: true, explicitHide: false, envDefault: false }), true);
});
