# World import

World import is a package-first pipeline for turning HTML/XHTML source collections, ZIPs, and EPUB-like archives into a provenance-rich markdown world library.

The architecture deliberately keeps semantics in skills and model prompts. TypeScript helper code handles deterministic operations only:

- normalize source files and archives;
- create stable source/unit ids and block anchors;
- list units and read bounded source slices;
- persist generic stage envelopes;
- emit model-authored artifact packets as markdown.

It does **not** decide entity identity, aliases, relationships, conflicts, or fact semantics.

## CLI

```bash
npm run world-import -- --input ./sources --output /tmp/world-import --model anthropic/claude-sonnet-4-5
```

Equivalent installed binary:

```bash
memchat-world-import --input ./sources --output /tmp/world-import --model anthropic/claude-sonnet-4-5
```

Options:

- `--input` — HTML/XHTML directory, `.zip`, or `.epub`-style archive.
- `--output` — output root.
- `--model` / `MEMCHAT_WORLD_IMPORT_MODEL` — model used by the skill.
- `--reviewer-model` / `MEMCHAT_WORLD_IMPORT_REVIEWER_MODEL` — optional stronger reviewer model.
- `--thinking` — pi thinking level.
- `--dry-run` — validate setup and normalization without doing semantic extraction.
- `--debug` / `MEMCHAT_WORLD_IMPORT_DEBUG=1` — print startup, paths, model selection, prompt, and tool start/end diagnostics to stderr.
- `--show-thinking` / `MEMCHAT_WORLD_IMPORT_SHOW_THINKING=1` — print thinking deltas when the selected provider/model exposes them. If `--thinking off` or the provider does not emit thinking blocks, there may be no thinking output.
- `--show-tool-updates` / `MEMCHAT_WORLD_IMPORT_SHOW_TOOL_UPDATES=1` — with debug enabled, print verbose tool update payloads in addition to tool start/end lines.

## Helper commands

Skills and other harnesses can use deterministic helpers directly:

```bash
npm run world-import-helper -- normalize --input ./sources --output /tmp/world-import
npm run world-import-helper -- list-units --output /tmp/world-import
npm run world-import-helper -- read-unit --output /tmp/world-import --unit <unit-id>
npm run world-import-helper -- read-slice --output /tmp/world-import --unit <unit-id> --start b0001 --end b0003
npm run world-import-helper -- write-extraction --output /tmp/world-import --unit <unit-id> < extraction.json
npm run world-import-helper -- write-merge --output /tmp/world-import < merge.json
npm run world-import-helper -- emit --output /tmp/world-import
npm run world-import-helper -- eval --output /tmp/world-import --reviewer-model anthropic/claude-opus-4-5
```

## Output layout

```text
<output-root>/
  sources/
    manifest.json
    normalized/<unit-id>.json
  stages/
    extraction/<unit-id>.json
    merge/merged-candidates.json
  world/
    people/
    places/
    things/
    facts/
```

## Stage contract boundary

Extraction candidates are model-authored and opaque to helper code except for optional routing/provenance envelope fields. Merged artifacts use a generic packet:

```json
{
  "id": "artifact-id",
  "group": "people",
  "title": "Artifact Title",
  "sections": [{ "heading": "Summary", "body": "Markdown body" }],
  "provenance": [{ "sourceId": "...", "unitId": "...", "startAnchor": "b0001", "endAnchor": "b0001", "quote": "..." }],
  "related": [],
  "metadata": {}
}
```

For a concise shell-oriented quick-start covering build, API key setup, run flags, helper commands, and output inspection, see [`docs/world-import-run-guide.md`](./world-import-run-guide.md).

See `skills/world-import/references/contracts.md` for model-facing details.

## Debugging model runs

Use debug mode when checking whether a model is following the skill workflow:

```bash
npm run world-import -- --input ~/Downloads/pg11-images-3.epub --output /tmp/pg11-world --model openrouter/google/gemma-4-31b-it:free --debug --show-tool-updates
```

The CLI prints status lines for argument resolution, pi auth/model paths, skill loading, active model, the `/skill:world-import` prompt, tool calls, and a final output summary. A successful model turn with `worldMarkdownFiles: 0` means the model did not complete the import even if the process exited cleanly.
