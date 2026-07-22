# Brief subagent facility acceptance

Installation acceptance answers a narrow operational question:

> Is one available subagent facility configured well enough that this agent has a good chance of completing a mem-import run?

The parent agent chooses from the facilities actually installed in its tool catalog. Mem-import does not require a named extension, programmatic adapter, exhaustive role certification, or a miniature import.

## Fast path: reuse a known recipe

First inspect [facility recipes](facility-recipes.md) and any repo-local cached finding. Reuse a recipe when its observable fingerprint still matches the current facility, extension/runtime version when available, mem-import tool schema/source revision, model family, and required capabilities.

A known recipe is guidance, not permanent trust. If parameters are rejected, tools are missing, or lifecycle behavior differs, discard the cached result and run the brief probe.

## Brief probe

Keep the probe disposable and short:

1. Choose one installed subagent facility and an invocation shape from its tool schema or known recipe.
2. Launch one disposable child with explicit model, thinking, cwd, and a narrow tool list.
3. Confirm the child starts, sees the requested tools, can call one harmless/read-only mem-import tool when tool routing is uncertain, and returns a usable terminal identity/outcome.
4. If real imports require coordinator → worker recursion, test it once: the disposable parent child launches one tiny nested child and then stops. Do not schedule semantic stages.
5. Test interruption or resume only when the planned import will rely on that feature.
6. Record the working parameters and observations, then discard the probe state.

Prefer a no-op lifecycle completion or one read/status call. A write probe is justified only when the facility cannot otherwise demonstrate that assigned extension tools are callable; if used, target one tiny disposable fixture and exactly one call.

Stop as soon as the facility has demonstrated the capabilities the planned run needs. Do not probe every semantic role merely because those roles exist.

## Acceptable evidence

Use the strongest evidence the chosen facility exposes:

- accepted launch parameters;
- child/session identity and terminal outcome;
- observed model and thinking setting;
- requested or host-observed active tools;
- extension loading/inheritance behavior;
- nested launch behavior when required;
- interruption/resume behavior when required.

Host-attested exact tool telemetry is valuable when available, but is not a universal extension requirement. Never manufacture observed values from worker prose. Record unavailable evidence as unavailable rather than rejecting every facility that lacks one adapter-specific feature.

Acceptance is a confidence check. During the real import, live assignments, grants, per-worker tool restrictions, durable effects, dispatch correlation, and final checks remain authoritative. A cached finding never excuses a broadened or failed corpus dispatch.

## Cache the invocation recipe

Repo-local findings may be stored under:

```text
.memchat/mem-import/facility-recipes/<facility-id>.json
```

This tree is local/ignored by default. A sanitized recipe for a popular facility may be version-controlled as Markdown under `references/adapters/`.

Cache only:

- facility/tool name and observable version or source identity;
- successful parameter names and values that are not sensitive;
- model/thinking/cwd/tool-list behavior;
- lifecycle controls the host adds;
- extension loading or inheritance behavior;
- whether nested launch, interruption, or resume was tested;
- mem-import source/tool-schema revision and completion time;
- concise limitations or unavailable evidence.

Never cache prompts, grants, coordinator authority, credentials, source payloads, session transcript paths, or hidden reasoning.

## What acceptance excludes

Do not use brief acceptance for:

- extractor → proposer → merger → reviewer orchestration;
- checks, repair, finalization, or canonical output;
- Alice or another book-sized fixture;
- semantic quality, identity judgment, or efficiency measurement;
- exhaustive negative, concurrency, scale, or recovery testing;
- developing a custom adapter during an import request.

The repository's fixture-backed multi-role runner remains an optional maintainer conformance suite for production tools and schemas. It is not mandatory preflight and does not privilege its Pi SDK transport over another installed subagent facility.
