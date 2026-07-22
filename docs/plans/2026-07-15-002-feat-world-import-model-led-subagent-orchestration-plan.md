---
title: "feat: Move world-import to model-led subagent orchestration with typed tools"
type: feat
date: 2026-07-15
origin: conversation and subagent-extension research
status: archived
---

# Archived: model-led mem-import orchestration

> **Archived historical plan.** Read the [complete archived record](archive/2026-07-15-002-feat-world-import-model-led-subagent-orchestration-plan.md). This stub retains only durable architectural decisions; its former executable next steps and milestone gates are not current authority.

## Durable decisions

- Expose deterministic import operations through role-scoped typed tools rather than shell-driven helper commands.
- Keep identity, canon, conflict/retcon handling, narrative synthesis, review judgment, and orchestration topology model-owned; deterministic services validate scope, structure, hashes, accounting, and atomicity.
- Use bounded, durable ledgers and packets: extraction inventories, immutable proposals, identity/conflict records, candidate dispositions, read sets, and serialized canonical transactions instead of full-corpus handoffs or monolithic snapshot writes.
- Bind every semantic worker to a durable assignment, scoped grant, exact role tool allowlist, and correlatable lifecycle record; fail closed when the selected subagent facility cannot enforce the contract.
- Separate persistent compendia from individual import runs so books and editions can update affected canonical content while preserving provenance, history, and reconstructability.
- Bind semantic reviews to exact revisions and read sets, then apply accepted repairs through bounded, fenced transactions with selective review invalidation.
- Treat legacy `world-import` as migration/reference material to be removed after useful deterministic behavior is retained under `mem-import`; do not preserve obsolete aliases, paths, vocabulary, or roadmap labels in active product surfaces.

## Current authority

- Normal installation acceptance: [brief facility acceptance](../../skills/mem-import/references/acceptance.md).
- Optional maintainer conformance/runtime safety: [focused-probe plan](2026-07-21-002-fix-mem-import-acceptance-simplification-plan.md).
- Real-import efficiency and evaluation: [efficiency-parity plan](2026-07-21-001-fix-mem-import-efficiency-parity-plan.md).
- Current authority mapping: [weekly consolidation](2026-07-22-mem-import-weekly-consolidation.md).
