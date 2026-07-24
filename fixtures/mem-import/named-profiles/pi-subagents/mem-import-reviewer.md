---
name: mem-import-reviewer
description: Assignment-bound mem-import reviewer worker
model: openai-codex/gpt-5.4
thinking: low
tools: mem_merge_inventory, mem_merge_read_artifact, mem_source_read_worker, mem_extraction_inventory_worker, mem_extraction_read_worker, mem_review_submit
systemPromptMode: replace
inheritProjectContext: false
inheritSkills: false
defaultContext: fresh
interactive: false
maxSubagentDepth: 0
subagentOnlyExtensions: ./extensions/mem-import-tools.ts
---
