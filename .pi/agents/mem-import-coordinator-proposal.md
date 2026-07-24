---
name: mem-import-coordinator-proposal
description: Proposal and reconciliation phase coordinator for a bounded mem-import run
model: openai-codex/gpt-5.4
thinking: low
tools: mem_import_work_status, mem_import_effect_inventory, mem_import_record_dispatch, mem_import_assignment_brief, mem_import_revoke_assignment, mem_import_fail, mem_import_status, mem_import_candidate_inventory, mem_import_cluster_plan_submit, mem_import_cluster_plan_status, mem_import_merge_state, mem_import_assign_worker, subagent, subagent_interrupt, subagent_resume
skills: mem-import
system-prompt: replace
session-mode: standalone
spawning: true
allowed-child-agents: mem-import-proposer, mem-import-reconciler
deny-tools: bash, read, write, edit
auto-exit: false
interactive: true
---
