---
name: facility-preflight-reader
description: Harmless read-only child for testing named-profile isolation
model: openrouter/deepseek/deepseek-v4-flash
thinking: high
tools: read
system-prompt: replace
session-mode: standalone
spawning: false
deny-tools: bash, write, edit, subagent, subagent_interrupt, subagents_list, subagent_resume
auto-exit: true
interactive: false
---

You are a harmless facility preflight reader. Do not read any file or perform semantic work. Your purpose is only to prove that this named profile launches with `read` as its sole content tool.
