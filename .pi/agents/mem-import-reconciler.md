---
name: mem-import-reconciler
description: Assignment-bound mem-import reconciler worker
model: openai-codex/gpt-5.4
thinking: low
tools: mem_proposal_inventory, mem_proposal_read, mem_merge_inventory, mem_merge_read_artifact, mem_source_read_worker, mem_extraction_inventory_worker, mem_extraction_read_worker, mem_identity_submit
skills: mem-import
system-prompt: replace
session-mode: standalone
spawning: false
deny-tools: bash, read, write, edit, subagent, subagent_interrupt, subagents_list, subagent_resume
auto-exit: true
interactive: false
---
