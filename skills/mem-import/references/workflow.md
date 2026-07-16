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

When `HERDR_ENV=1`, start the coordinator as a persistent interactive coding-agent pane (for example, `herdr agent start ... -- pi --approve`) from that workspace, then invoke `/skill:mem-import`. Do **not** use a one-shot print/shell job for a parent that launches async children: it can exit after dispatch and miss child completion steering. Keep the parent pane alive until it has inspected durable extraction packets; close the parent/child panes and delete only the run output after the demonstration. Retain the ignored workspace for later tests.

## 1. Discover the active worker facility

Inspect the current tool catalog and local documentation. A candidate may be an individual-spawn tool, a parallel/chain facility, or a harness-specific worker interface. Do not infer capability from a name alone.

For a proposed extractor dispatch, identify observable controls for:

- a child task, identity, completion/failure result, and wait mechanism;
- requested model, thinking, cwd, context, timeout, and concurrency;
- requested role/profile or exact child tool restrictions;
- interruption, stop, resume, and lifecycle telemetry.

Known profiles are evidence, not a trust verdict. If the host cannot make the bounded task reasonable, work inline or explain the limitation; do not build/install an adapter during an import.

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

The parent chooses one worker, parallel disjoint workers, a chain, or inline work. U1 does not hard-code a topology. Start with a small disjoint wave (normally one to three); after inspecting its durable packets and lifecycle/provider behavior, increase concurrency gradually only when that evidence is clean and the parent can keep up with completions. Reduce or stop fanout on repeated validation/schema errors, incomplete source coverage, provider/adapter failures, or parent backlog. Do not launch an entire corpus at maximum fanout before early evidence is available.

After a worker returns or fails:

1. Use the adapter's task/run identity and native wait/status behavior as lifecycle evidence.
2. Call `mem_extraction_status` and `mem_extraction_read` with the assignment bootstrap.
3. Inspect the persisted candidate envelope and compare it with the normalized source. Do not rely only on worker prose.
4. Decide whether to accept the packet, re-extract, escalate the model, try another adapter, assign more units, or stop.
5. Revoke superseded/interrupted assignments before replacing them.

## 5. Current stopping point

U1 ends after a small, artifact-backed extraction pass. Do not merge, emit, lint, review, finalize, or have TypeScript choose the next semantic stage. Those are later typed surfaces and parent decisions.
