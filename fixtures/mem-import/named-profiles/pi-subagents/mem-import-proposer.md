---
name: mem-import-proposer
description: Assignment-bound mem-import proposer worker
model: openai-codex/gpt-5.4
thinking: low
tools: mem_source_read_worker, mem_extraction_inventory_worker, mem_extraction_read_worker, mem_proposal_submit
systemPromptMode: replace
inheritProjectContext: false
inheritSkills: false
defaultContext: fresh
interactive: false
maxSubagentDepth: 0
subagentOnlyExtensions: ./extensions/mem-import-tools.ts
---
