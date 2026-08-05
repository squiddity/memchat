import type { ArtifactPacket } from "./contracts.js";

export type NarrativeSurfaceKind = "synopsis" | "timeline" | "scene-guide";

const SYNOPSIS_ALIASES = new Set(["plot synopsis", "corpus synopsis", "world overview", "story overview"]);
const TIMELINE_LABELS = ["timeline", "story so far", "reading order"];
const SCENE_GUIDE_LABELS = [
  "scene guide",
  "chapter guide",
  "episode guide",
  "act guide",
  "scene summary",
  "chapter summary",
  "episode summary",
  "act summary",
];

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function metadataString(metadata: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" ? normalize(value) : undefined;
}

function metadataStringList(metadata: Record<string, unknown> | undefined, key: string): string[] {
  const value = metadata?.[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").map(normalize);
}

function tokenSet(artifact: ArtifactPacket): Set<string> {
  const tokens = new Set<string>();
  for (const value of [artifact.type, artifact.title, ...(artifact.tags ?? [])]) {
    if (typeof value === "string") tokens.add(normalize(value));
  }
  for (const key of ["narrativeSurface", "surface", "surfaceType", "artifactType"]) {
    const value = metadataString(artifact.metadata, key);
    if (value) tokens.add(value);
  }
  for (const key of ["narrativeSurfaces", "surfaces", "surfaceTags"]) {
    for (const value of metadataStringList(artifact.metadata, key)) tokens.add(value);
  }
  return tokens;
}

function matchesAny(tokens: Set<string>, labels: string[]): boolean {
  return [...tokens].some((token) => labels.some((label) => token === label || token.includes(label)));
}

function isEntitySynopsisToken(token: string): boolean {
  return /(?:character|entity|person|place|location|thing|object) synopsis(?:$| )/.test(token) || /(?:character|entity|person|place|location|thing|object) .+ synopsis$/.test(token);
}

function matchesSynopsis(artifact: ArtifactPacket, tokens: Set<string>): boolean {
  // Explicit corpus-level aliases are intentionally narrow. A page titled
  // "Character Synopsis" must not satisfy the corpus synopsis gate.
  if ([...tokens].some(isEntitySynopsisToken)) return false;
  if ([...tokens].some((token) => SYNOPSIS_ALIASES.has(token))) return true;
  if (artifact.group !== "facts") return false;
  // The generic alias is retained for facts/corpus pages, including a facts
  // page whose title is a work-specific "... Synopsis".
  return [...tokens].some((token) => token === "synopsis" || token.endsWith(" synopsis"));
}

export function classifyNarrativeSurface(artifact: ArtifactPacket): NarrativeSurfaceKind[] {
  const tokens = tokenSet(artifact);
  const kinds: NarrativeSurfaceKind[] = [];
  if (matchesSynopsis(artifact, tokens)) kinds.push("synopsis");
  if (matchesAny(tokens, TIMELINE_LABELS)) kinds.push("timeline");
  if (matchesAny(tokens, SCENE_GUIDE_LABELS)) kinds.push("scene-guide");
  return kinds;
}

export function isNarrativeSurface(artifact: ArtifactPacket): boolean {
  return classifyNarrativeSurface(artifact).length > 0;
}
