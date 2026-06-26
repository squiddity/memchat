---
name: world-import
description: Import HTML/XHTML directories, ZIPs, or EPUB-like archives into provenance-rich markdown world-library artifacts. Use when asked to create or update a world library from source text while preserving source spans. Semantic extraction and merge decisions belong to the model; helper commands only normalize sources, persist stage envelopes, read slices, and emit model-authored artifact packets.
---

# World Import

You are running a model-owned, provenance-preserving world import. Keep semantic judgment in this skill workflow. Do not ask helper commands to decide entities, aliases, relationships, conflicts, or merge identity.

## Inputs

The user should provide JSON or text containing:

- `input`: path to an HTML/XHTML directory, `.zip`, or `.epub`-style archive.
- `output`: output root for normalized sources, stages, and `world/` markdown.
- `reviewerModel` optional: stronger model to recommend for review/eval.
- `dryRun` optional: validate setup without doing model extraction.
- `helperCommand` optional: exact helper command prefix to use, such as `npm run world-import-helper --` or `memchat-world-import-helper`.

If either `input` or `output` is missing, ask one focused question for the missing path.

## References

Read these before importing:

- `references/workflow.md` — command sequence and model-pass workflow.
- `references/contracts.md` — skill-owned candidate and artifact packet contracts.
- `references/artifact-format.md` — markdown output packet expectations.

## Helper commands

Prefer package scripts while developing this repo:

```bash
npm run world-import-helper -- normalize --input <input> --output <output>
npm run world-import-helper -- list-units --output <output>
npm run world-import-helper -- read-unit --output <output> --unit <unit-id>
npm run world-import-helper -- read-slice --output <output> --unit <unit-id> --start <anchor> --end <anchor>
npm run world-import-helper -- write-extraction --output <output> --unit <unit-id> < stage.json
npm run world-import-helper -- write-merge --output <output> < merged-stage.json
npm run world-import-helper -- emit --output <output>
npm run world-import-helper -- eval --output <output> --reviewer-model <provider/model>
```

Installed-package users may call `memchat-world-import-helper` with the same arguments. If invocation arguments include `helperCommand`, use that exact prefix for all helper calls.

## Workflow summary

1. Normalize the input. Inspect manifest diagnostics before continuing.
2. For each normalized unit, read bounded text and produce an extraction stage envelope. Extract reusable canon candidates, not chapter summaries. Preserve provenance spans for every candidate.
3. Merge from staged candidates, not whole raw files. Use `read-slice` only when candidate evidence is ambiguous or conflicting and only for the minimum anchor range needed.
4. Write a merge stage containing model-authored artifact packets.
5. Emit markdown from the artifact packets.
6. If a reviewer model is configured, run the eval helper after emission; otherwise report that reviewer-model scoring was skipped.
7. Summarize outputs, diagnostics, and any uncertainty/disputes preserved in metadata or sections.

When `dryRun` is true, stop after normalization/listing and report whether the helper surface is available.
