# Compendium runs

Use `mem_import_begin_compendium` for a series or maintained library. It creates a fresh isolated run root under `compendiumRoot/stages/runs/` while retaining a durable compendium record at `stages/compendium.json`.

- Supply stable `compendiumId` and `workId` values.
- Normalize through `mem_import_normalize_compendium_run`, not the generic normalizer, so the content-derived source hash and duplicate-work relationship are recorded.
- A duplicate hash is evidence, not an automatic semantic decision: inspect the prior run and choose an explicit no-op, replacement, or conflict path before canonical mutation.
- Run-local normalized sources, extraction packets, assignments, and proposals remain isolated. Do not assume this registry alone merges canon; bounded canonical transaction storage is migrated separately.
