---
name: mem-import-coordinator-extraction
description: Extraction phase coordinator for a bounded mem-import run
model: openai-codex/gpt-5.4
thinking: low
tools: mem_import_work_status, mem_import_effect_inventory, mem_import_record_dispatch, mem_import_assignment_brief, mem_import_revoke_assignment, mem_import_fail, mem_import_status, mem_import_inspect_manifest, mem_import_normalize, mem_import_normalize_compendium_run, mem_import_extraction_candidates, mem_import_assign_extractor, subagent, subagent_interrupt, subagent_resume
skills: mem-import
system-prompt: replace
session-mode: standalone
spawning: true
deny-tools: bash, read, write, edit
auto-exit: false
interactive: true
---
