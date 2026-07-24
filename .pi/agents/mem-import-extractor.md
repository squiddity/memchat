---
name: mem-import-extractor
description: Assignment-bound mem-import extractor worker
model: openai-codex/gpt-5.4
thinking: low
tools: mem_source_read_unit, mem_extraction_status, mem_extraction_read, mem_extraction_validate, mem_extraction_submit
skills: mem-import
system-prompt: replace
session-mode: standalone
spawning: false
deny-tools: bash, read, write, edit, subagent, subagent_interrupt, subagents_list, subagent_resume
auto-exit: true
interactive: false
---
