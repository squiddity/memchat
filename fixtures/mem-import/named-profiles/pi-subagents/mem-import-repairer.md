---
name: mem-import-repairer
description: Assignment-bound mem-import repairer worker
model: openai-codex/gpt-5.4
thinking: low
tools: mem_proposal_inventory, mem_proposal_read, mem_identity_inventory, mem_identity_read, mem_merge_inventory, mem_merge_read_artifact, mem_source_read_worker, mem_extraction_read_worker, mem_merge_acquire_lease, mem_merge_heartbeat_lease, mem_merge_apply_repair_batch, mem_merge_release_lease
systemPromptMode: replace
inheritProjectContext: false
inheritSkills: false
defaultContext: fresh
interactive: false
maxSubagentDepth: 0
subagentOnlyExtensions: ./extensions/mem-import-tools.ts
---
