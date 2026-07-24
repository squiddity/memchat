---
name: mem-import-extractor
description: Assignment-bound mem-import extractor worker
model: openai-codex/gpt-5.4
thinking: low
tools: mem_source_read_unit, mem_extraction_status, mem_extraction_read, mem_extraction_validate, mem_extraction_submit
systemPromptMode: replace
inheritProjectContext: false
inheritSkills: false
defaultContext: fresh
interactive: false
maxSubagentDepth: 0
subagentOnlyExtensions: ./extensions/mem-import-tools.ts
---
