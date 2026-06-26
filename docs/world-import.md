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

See `skills/world-import/references/contracts.md` for model-facing details.
