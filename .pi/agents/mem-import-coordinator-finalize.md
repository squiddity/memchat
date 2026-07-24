---
name: mem-import-coordinator-finalize
description: Review, repair, and finalization phase coordinator for a bounded mem-import run
model: openai-codex/gpt-5.4
thinking: low
tools: mem_import_work_status, mem_import_effect_inventory, mem_import_record_dispatch, mem_import_assignment_brief, mem_import_revoke_assignment, mem_import_fail, mem_import_merge_state, mem_import_assign_worker, mem_import_acquire_merge_lease, mem_import_heartbeat_merge_lease, mem_import_release_merge_lease, mem_check_run, mem_import_finalize, subagent, subagent_interrupt, subagent_resume
skills: mem-import
system-prompt: replace
session-mode: standalone
spawning: true
allowed-child-agents: mem-import-reviewer, mem-import-repairer
deny-tools: bash, read, write, edit
auto-exit: false
interactive: true
---
