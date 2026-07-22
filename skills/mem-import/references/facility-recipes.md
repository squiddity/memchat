# Subagent facility recipes

A facility recipe records sanitized invocation parameters that worked in a brief capability probe. Reuse it only while the local environment matches.

## Resolution order

1. Reuse a matching repo-local finding from `.memchat/mem-import/facility-recipes/`.
2. Consult a version-controlled adapter reference for a known popular facility.
3. Inspect the live tool schema and run [brief acceptance](acceptance.md).
4. If none can satisfy the planned run, stop with the missing capabilities. Do not implement an adapter during the import.

## Suggested local shape

```json
{
  "version": 1,
  "facilityId": "installed-tool-name",
  "observedVersion": "optional",
  "toolName": "subagent",
  "parameters": {
    "model": "provider/model-id",
    "thinking": "high",
    "cwd": "repository",
    "toolsParameter": "tools",
    "extensionMode": "optional",
    "autoExit": false
  },
  "lifecycleTools": [],
  "capabilities": {
    "nestedLaunch": "passed",
    "resume": "not-tested",
    "hostToolTelemetry": "unavailable"
  },
  "memImportRevision": "source-or-tool-schema-fingerprint",
  "checkedAt": "ISO-8601"
}
```

This is descriptive, not a universal adapter API. Omit unsupported parameters and use `passed`, `failed`, `not-tested`, or `unavailable` for capabilities.

Recipes may contain only facility identity/version, non-sensitive invocation parameters, model/thinking/cwd/tool-list behavior, host-added lifecycle controls, extension loading/inheritance behavior, tested capability results, mem-import revision/time, and concise limitations. Never include prompts, grants, coordinator authority, credentials, source payloads, transcript paths, or hidden reasoning.

## Version-controlled examples

- [pi-herdr-subagents](adapters/pi-herdr-subagents.md)
- [generic pi-subagents](adapters/pi-subagents.md)

Checked-in examples must also omit local session identities, absolute user paths, and acceptance receipts.
