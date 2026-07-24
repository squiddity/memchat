---
name: mem-import-proposer
description: Assignment-bound mem-import proposer worker
model: openai-codex/gpt-5.4
thinking: low
tools: mem_source_read_worker, mem_extraction_inventory_worker, mem_extraction_read_worker, mem_proposal_submit
skills: mem-import
system-prompt: replace
session-mode: standalone
spawning: false
deny-tools: bash, read, write, edit, subagent, subagent_interrupt, subagents_list, subagent_resume
auto-exit: true
interactive: false
---
