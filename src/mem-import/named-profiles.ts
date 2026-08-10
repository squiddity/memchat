import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MEM_IMPORT_ROLE_TOOLS, MEM_IMPORT_ROLE_TO_PROFILE, type AssignmentRole } from "./service.js";
export { MEM_IMPORT_ROLE_TO_PROFILE } from "./service.js";
export const MEM_IMPORT_PROFILE_EXTENSION = "./extensions/mem-import-tools.ts";
export const MEM_IMPORT_PROFILE_SKILL = "mem-import";
export const MEM_IMPORT_PROFILE_MODEL = "openai-codex/gpt-5.4";
export const MEM_IMPORT_PROFILE_THINKING = "low";
export type MemImportProfileAdapter = "pi-herdr-subagents" | "pi-subagents";
export type MemImportCoordinatorPhase = "extraction" | "proposal" | "merge" | "review" | "repair" | "verify" | "finalize";
export const MEM_IMPORT_COORDINATOR_ALLOWED_CHILDREN: Record<MemImportCoordinatorPhase, readonly string[]> = {
  extraction: [MEM_IMPORT_ROLE_TO_PROFILE.extractor], proposal: [MEM_IMPORT_ROLE_TO_PROFILE.proposer, MEM_IMPORT_ROLE_TO_PROFILE.reconciler], merge: [MEM_IMPORT_ROLE_TO_PROFILE.merger], review: [MEM_IMPORT_ROLE_TO_PROFILE.reviewer], repair: [MEM_IMPORT_ROLE_TO_PROFILE.repairer], verify: [MEM_IMPORT_ROLE_TO_PROFILE.reviewer], finalize: [],
};
const HERDR_COORDINATOR_LIFECYCLE_TOOLS = ["subagent", "subagent_interrupt", "subagent_resume"] as const;
const PI_SUBAGENTS_COORDINATOR_LIFECYCLE_TOOLS = ["subagent"] as const;
const COMMON_COORDINATOR_TOOLS = ["mem_import_work_status", "mem_import_effect_inventory", "mem_import_record_dispatch", "mem_import_assignment_brief", "mem_import_revoke_assignment", "mem_import_fail"] as const;
export const MEM_IMPORT_COORDINATOR_PHASE_TOOLS: Record<MemImportCoordinatorPhase, readonly string[]> = {
  extraction: [...COMMON_COORDINATOR_TOOLS, "mem_import_status", "mem_import_inspect_manifest", "mem_import_normalize", "mem_import_normalize_compendium_run", "mem_import_extraction_candidates", "mem_import_assign_extractor"],
  proposal: [...COMMON_COORDINATOR_TOOLS, "mem_import_status", "mem_import_candidate_inventory", "mem_import_cluster_plan_submit", "mem_import_cluster_plan_status", "mem_import_merge_state", "mem_import_assign_worker"],
  merge: [...COMMON_COORDINATOR_TOOLS, "mem_import_cluster_plan_status", "mem_import_merge_state", "mem_import_assign_worker"],
  review: [...COMMON_COORDINATOR_TOOLS, "mem_import_merge_state", "mem_import_quality_state", "mem_import_review_checkpoint_state", "mem_import_assign_worker"],
  repair: [...COMMON_COORDINATOR_TOOLS, "mem_import_merge_state", "mem_import_quality_state", "mem_import_repair_campaign_state", "mem_import_assign_worker"],
  verify: [...COMMON_COORDINATOR_TOOLS, "mem_import_merge_state", "mem_import_repair_campaign_state", "mem_import_assign_worker", "mem_import_verification_submit"],
  finalize: [...COMMON_COORDINATOR_TOOLS, "mem_import_merge_state", "mem_import_quality_state", "mem_import_repair_campaign_state", "mem_check_run", "mem_import_acquire_merge_lease", "mem_import_release_merge_lease", "mem_import_finalize"],
};
export type MemImportNamedProfile = { name: string; description: string; kind: "coordinator" | "worker"; phase?: MemImportCoordinatorPhase; role?: AssignmentRole; spawning: boolean; autoExit: boolean; maxSubagentDepth: number; allowedChildAgents?: readonly string[] };
const coordinatorProfiles: MemImportNamedProfile[] = ([
  ["extraction", "Extraction"], ["proposal", "Proposal and reconciliation"], ["merge", "Canonical merge"], ["review", "Read-only semantic review"], ["repair", "Bounded repair campaign"], ["verify", "Read-only repair verification"], ["finalize", "Deterministic finalization"],
] as const).map(([phase, label]) => ({ name: `mem-import-coordinator-${phase}`, description: `${label} phase coordinator for a bounded mem-import run`, kind: "coordinator", phase, spawning: phase !== "finalize", autoExit: true, maxSubagentDepth: phase === "finalize" ? 0 : 1, ...(phase !== "finalize" ? { allowedChildAgents: MEM_IMPORT_COORDINATOR_ALLOWED_CHILDREN[phase] } : {}) }));
const workerProfiles: MemImportNamedProfile[] = (Object.keys(MEM_IMPORT_ROLE_TOOLS) as AssignmentRole[]).map((role) => ({ name: MEM_IMPORT_ROLE_TO_PROFILE[role], description: `Assignment-bound mem-import ${role} worker`, kind: "worker", role, spawning: false, autoExit: true, maxSubagentDepth: 0 }));
export const MEM_IMPORT_NAMED_PROFILES: readonly MemImportNamedProfile[] = [...coordinatorProfiles, ...workerProfiles];
const DENIED_GENERIC_TOOLS = ["bash", "read", "write", "edit"];
const DENIED_WORKER_LAUNCH_TOOLS = ["subagent", "subagent_interrupt", "subagents_list", "subagent_resume"];
export function memImportProfileTools(profile: MemImportNamedProfile, adapter: MemImportProfileAdapter): readonly string[] {
  if (profile.kind === "worker") return MEM_IMPORT_ROLE_TOOLS[profile.role!];
  const lifecycle = adapter === "pi-herdr-subagents" ? HERDR_COORDINATOR_LIFECYCLE_TOOLS : PI_SUBAGENTS_COORDINATOR_LIFECYCLE_TOOLS;
  return profile.phase === "finalize" ? [...MEM_IMPORT_COORDINATOR_PHASE_TOOLS.finalize] : [...MEM_IMPORT_COORDINATOR_PHASE_TOOLS[profile.phase!], ...lifecycle];
}
const PROFILE_BODIES_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../skills/mem-import/references/profile-bodies");
const PROFILE_BODY_FILES: Record<string, string> = { extraction: "coordinator-extraction.md", proposal: "coordinator-proposal-reconciliation.md", merge: "coordinator-merge.md", review: "coordinator-review.md", repair: "coordinator-repair.md", verify: "coordinator-verify.md", finalize: "coordinator-finalize.md", extractor: "extractor.md", proposer: "proposer.md", reconciler: "reconciler.md", merger: "merger.md", reviewer: "reviewer.md", repairer: "repairer.md" };
function memImportProfileBody(profile: MemImportNamedProfile): string { const key = profile.kind === "coordinator" ? profile.phase! : profile.role!; const filename = PROFILE_BODY_FILES[key]; if (!filename) throw new Error(`No generated mem-import profile body for ${key}`); const body = readFileSync(resolve(PROFILE_BODIES_ROOT, filename), "utf8").trim(); if (!body) throw new Error(`Mem-import profile body is empty for ${key}`); return body; }
export function renderMemImportNamedProfile(profile: MemImportNamedProfile, adapter: MemImportProfileAdapter): string {
  const tools = memImportProfileTools(profile, adapter);
  const common = ["---", `name: ${profile.name}`, `description: ${profile.description}`, `model: ${MEM_IMPORT_PROFILE_MODEL}`, `thinking: ${MEM_IMPORT_PROFILE_THINKING}`, `tools: ${tools.join(", ")}`];
  if (adapter === "pi-herdr-subagents") { const denied = profile.kind === "worker" ? [...DENIED_GENERIC_TOOLS, ...DENIED_WORKER_LAUNCH_TOOLS] : DENIED_GENERIC_TOOLS; return [...common, "system-prompt: replace", "session-mode: standalone", `spawning: ${profile.spawning}`, ...(profile.allowedChildAgents ? [`allowed-child-agents: ${profile.allowedChildAgents.join(", ")}`] : []), `deny-tools: ${denied.join(", ")}`, `auto-exit: ${profile.autoExit}`, `interactive: ${profile.kind === "coordinator"}`, "---", "", memImportProfileBody(profile), ""].join("\n"); }
  return [...common, "systemPromptMode: replace", "inheritProjectContext: false", "inheritSkills: false", "defaultContext: fresh", `interactive: ${profile.kind === "coordinator"}`, `maxSubagentDepth: ${profile.maxSubagentDepth}`, `subagentOnlyExtensions: ${MEM_IMPORT_PROFILE_EXTENSION}`, "---", "", memImportProfileBody(profile), ""].join("\n");
}
