# Subagent facility recipes

A facility recipe is a small record of invocation parameters that worked for a brief mem-import capability probe. Recipes let future imports skip repeated discovery when the local environment still matches.

## Resolution order

1. Reuse a matching repo-local finding from `.memchat/mem-import/facility-recipes/`.
2. Consult a version-controlled adapter reference for a known popular facility.
3. Inspect the live tool schema and run the brief probe in [acceptance](acceptance.md).
4. If no facility can satisfy the planned run, stop with concrete missing capabilities. Do not implement an adapter during the import.

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

The shape is descriptive rather than a universal adapter API. Omit unsupported parameters and record capability values as `passed`, `failed`, `not-tested`, or `unavailable`.

## Version-controlled examples

- [pi-herdr-subagents](adapters/pi-herdr-subagents.md)
- [generic pi-subagents](adapters/pi-subagents.md)
- [Pi SDK maintainer conformance](adapters/pi-sdk.md) — optional developer suite, not normal facility discovery

Checked-in examples contain no local session identities, absolute user paths, credentials, grants, prompts, or acceptance receipts.
