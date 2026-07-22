import { resolve } from "node:path";
import { ALL_ACCEPTANCE_PROBES, CORE_ACCEPTANCE_PROBES, runFocusedAcceptance } from "../src/mem-import/focused-acceptance-runner.js";
import { PiSdkAcceptanceHostAdapter } from "../src/mem-import/pi-sdk-acceptance-adapter.js";
import { acceptanceSourceRevision } from "../src/mem-import/source-revision.js";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const model = argument("--model");
if (!model) throw new Error("Usage: npm run acceptance:mem-import -- --model <provider/model-id> [--thinking high] [--all-roles] [--state-root path] [--disposable-root path]");
const thinking = argument("--thinking") ?? "high";
const allRoles = process.argv.includes("--all-roles");
const requiredProbes = [...(allRoles ? ALL_ACCEPTANCE_PROBES : CORE_ACCEPTANCE_PROBES)];
const selectedProbeNames = argument("--probes")?.split(",").map((item) => item.trim()).filter(Boolean);
const probes = selectedProbeNames?.length
  ? selectedProbeNames.map((name) => {
      const probe = requiredProbes.find((item) => item === name);
      if (!probe) throw new Error(`Probe ${name} is not enabled by the selected acceptance profile`);
      return probe;
    })
  : requiredProbes;
const cwd = process.cwd();
const host = new PiSdkAcceptanceHostAdapter(cwd);
const result = await runFocusedAcceptance({
  fixtureRoot: resolve(cwd, "fixtures/mem-import/acceptance/v1"),
  ...(argument("--state-root") ? { stateRoot: resolve(argument("--state-root")!) } : {}),
  ...(argument("--disposable-root") ? { disposableRoot: resolve(argument("--disposable-root")!) } : {}),
  profile: {
    protocolVersion: 1,
    toolSchemaVersion: "mem-import-tools-v1",
    model,
    thinking,
    sourceRevision: await acceptanceSourceRevision(cwd),
  },
  host,
  probes,
  requiredProbes,
});
console.log(JSON.stringify({
  status: result.receipt.status,
  fingerprint: result.receipt.fingerprint,
  receiptPath: result.receiptPath,
  probes: result.probes.map((probe) => ({ probe: probe.probe, effectKind: probe.effectKind, effectHash: probe.effectHash })),
}, null, 2));
