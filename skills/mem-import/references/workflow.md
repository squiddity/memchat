# Coordinator workflow

The coordinator is the parent model using `mem-import` skill guidance. It owns semantic and orchestration judgment; typed tools enforce only deterministic structure, persistence, and authorization boundaries.

## Live Herdr test workspace

Herdr and its subagent facility are details of this installation's local test setup, **not** `mem-import` prerequisites or a requirement for other Pi installations. The coordinator may use another host-provided worker facility when it satisfies the capability requirements below; do not present Herdr commands as universal setup instructions.

For a local, visible Herdr experiment, keep the disposable Pi project configuration under this repository at:

```text
<repo>/.memchat-agent-testing/
  .pi/settings.json
```

Do **not** create a sibling test directory under a shared `projects/` folder and do not rely on `/tmp` as the durable test configuration location. The workspace is ignored by the repository's `.memchat*` rule. Its package setting should point back at the repository package, relative to the settings file:

```json
{
  "packages": ["../.."]
}
```

When `HERDR_ENV=1`, start a long-lived coordinator in a dedicated tab as a persistent interactive coding-agent pane (for example, `herdr agent start ... -- pi --approve`) from that workspace, then invoke `/skill:mem-import`. Output roots are resolved from the coordinator's current working directory: a coordinator launched in `<repo>/.memchat-agent-testing/` must pass `output/<run-name>` or an absolute `<repo>/.memchat-agent-testing/output/<run-name>`—never prefix the workspace name again. Do **not** use a one-shot print/shell job for a parent that launches async children: it can exit after dispatch and miss child completion steering. Keep the parent pane alive until it has inspected durable extraction packets; close the parent/child panes and delete only the run output after the demonstration. Retain the ignored workspace for later tests.

## 1. Discover the active worker facility

Inspect the current tool catalog and local documentation. A candidate may be an individual-spawn tool, a parallel/chain facility, or a harness-specific worker interface. Do not infer capability from a name alone.

For a proposed extractor dispatch, identify observable controls for:

- a child task, identity, completion/failure result, and wait mechanism;
- requested model, thinking, cwd, context, timeout, and concurrency;
- requested role/profile or exact child tool restrictions;
- interruption, stop, resume, and lifecycle telemetry.

Known profiles are evidence, not a trust verdict. For a delegated mem-import run, extraction and merge require an actual subagent facility that can launch workers and enforce the requested exact role allowlist. If no such facility is available, call `mem_import_fail` with a concise credential-free reason and stop; do not build/install an adapter or work those roles inline during an import.

## 2. Establish deterministic source state

1. Call `mem_import_begin` with a fresh output root.
2. Call `mem_import_normalize` with the input.
3. Read `mem_import_inspect_manifest` and inspect the complete ordered unit list.
4. Use `mem_import_status` to understand persisted extraction state.

Normalization is deterministic; deciding which units to delegate, whether some need more attention, and when to proceed remains model-owned.

## 3. Create a bounded extractor assignment

For every extractor attempt:

1. Choose a unique task ID and disjoint normalized unit IDs.
2. Call `mem_import_assign_extractor`.
3. Deliver its bootstrap only to that worker through the selected adapter. Keep grants out of world/import artifacts and concise receipts.
4. Deliver a self-contained extractor task: include the extractor-role packet contract and truncation procedure, not merely a path or instruction to read shared skill files. A narrowly allowlisted child may intentionally lack generic `read` access.
5. Request the extractor role plus only the five U1 typed source/extraction tools where the host can enforce an allowlist. If it cannot, record that as an observed limitation.

The durable assignment validates the run/root, role, allowed capability, expiry/revocation state, and unit scope in each extractor tool process. It is an application authorization boundary; it does not by itself sandbox an adapter that also exposes shell or generic filesystem tools.

## 4. Dispatch, wait, and inspect

The parent chooses one worker, parallel disjoint workers, or a facility-native chain; it must use the selected facility for extraction. Start with a small disjoint wave (normally one to three); after inspecting durable packets and lifecycle/provider behavior, increase concurrency gradually only when that evidence is clean and the parent can keep up with completions. Reduce or stop fanout on repeated validation/schema errors, incomplete source coverage, provider/adapter failures, or parent backlog. Do not launch an entire corpus at maximum fanout before early evidence is available.

After a worker returns or fails:

1. Use the adapter's task/run identity and native wait/status behavior as lifecycle evidence.
2. Call `mem_extraction_status` and `mem_extraction_read` with the assignment bootstrap.
3. Inspect the persisted candidate envelope and compare it with the normalized source. Do not rely only on worker prose.
4. Decide whether to accept the packet, re-extract, escalate the model, try another adapter, assign more units, or stop.
5. Revoke superseded/interrupted assignments before replacing them.

## 5. Merge through a single fenced writer

After the parent judges extraction evidence sufficient, it must assign one `merger` worker through the selected facility with a host-enforced role allowlist. Read [the merger role](merger-role.md) before delegation. If that facility can no longer meet the requirement, record a terminal `mem_import_fail` rather than merging inline.

1. Read the authoritative merge state and extraction packets; do not rely on worker prose.
2. Acquire the global merge lease. Its fence, 60-second heartbeat, and five-minute expiry protect the whole merge state; only recover it after expiry.
3. Write a complete semantic snapshot with the exact revision/hash read in step 1. Every accepted write produces a new immutable content-addressed receipt under `stages/merge/revisions/`.
4. On stale CAS or fence failure, re-read durable state and make a fresh semantic decision. Never retry an old snapshot blindly.
5. Release the lease when the mutation is complete.

Coordinator merge/write tools remain for deterministic inspection and explicit administrative recovery tests; they are not an alternative to the mandatory delegated merger in a delegated import run.

## 6. Review and bounded repair

Read [the reviewer role](reviewer-role.md) and [repairer role](repairer-role.md) before delegation.

- A reviewer receives read tools and `mem_review_submit` only. Its immutable packet must name the exact merge revision/hash reviewed; it cannot change world state.
- The parent inspects packets and decides which recommendations to accept. It may reject them, request another lens, or work inline.
- A repairer assignment must name explicit checkpoint/action IDs. It may acquire the same global merge lease and write only a full revised snapshot that cites those IDs.

## 7. Checks and finalization

The parent may run deterministic checks at any time. When it judges the world ready, it acquires a coordinator merge lease and calls finalization. Finalization emits Markdown, reruns deterministic lint/coverage/provenance/readiness checks, stores a check packet, and writes `stages/import-run.json` schema v2.

Warnings remain inspectable evidence. Error-level diagnostics prevent a finalized-success state. Typed tools never choose whether a semantic repair is warranted; the parent does.
