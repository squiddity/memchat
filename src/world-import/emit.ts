import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ArtifactPacket, WorldImportGroup } from "./types.js";
import { readMergeStage, validateStageEnvelope } from "./staging.js";

const groups: WorldImportGroup[] = ["people", "places", "things", "facts"];

export function slugify(text: string): string {
  const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  return slug || "artifact";
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function frontmatter(artifact: ArtifactPacket): string {
  const lines = ["---", `id: ${yamlString(artifact.id)}`, `group: ${artifact.group}`, `title: ${yamlString(artifact.title)}`];
  if (artifact.related?.length) lines.push(`related: [${artifact.related.map(yamlString).join(", ")}]`);
  if (artifact.metadata && Object.keys(artifact.metadata).length > 0) lines.push("metadata: true");
  lines.push("---");
  return lines.join("\n");
}

function renderRelated(related: string[] | undefined): string {
  if (!related || related.length === 0) return "";
  const lines = ["## Related", ...[...related].sort().map((id) => `- [[${id}]]`)];
  return `${lines.join("\n")}\n\n`;
}

function renderProvenance(artifact: ArtifactPacket): string {
  const lines = ["## Provenance"];
  for (const [index, ref] of artifact.provenance.entries()) {
    lines.push(`${index + 1}. \`${ref.sourceId}/${ref.unitId}#${ref.startAnchor}-${ref.endAnchor}\``);
    lines.push(`   > ${ref.quote.replace(/\s+/g, " ").trim()}`);
  }
  return `${lines.join("\n")}\n`;
}

export function renderArtifactMarkdown(artifact: ArtifactPacket): string {
  const sections = artifact.sections.map((section) => `## ${section.heading}\n\n${section.body.trim()}\n\n`).join("");
  return `${frontmatter(artifact)}\n\n# ${artifact.title}\n\n${sections}${renderRelated(artifact.related)}${renderProvenance(artifact)}`;
}

export async function emitWorldLibrary(outputRoot: string): Promise<string[]> {
  const merge = await readMergeStage(outputRoot);
  validateStageEnvelope(merge, { requireArtifacts: true });
  const artifacts = merge.artifacts ?? [];
  const worldRoot = join(outputRoot, "world");
  await rm(worldRoot, { recursive: true, force: true });
  for (const group of groups) await mkdir(join(worldRoot, group), { recursive: true });
  const used = new Map<string, number>();
  const written: string[] = [];
  for (const artifact of [...artifacts].sort((a, b) => `${a.group}:${a.title}`.localeCompare(`${b.group}:${b.title}`))) {
    const base = slugify(artifact.id || artifact.title);
    const count = used.get(`${artifact.group}/${base}`) ?? 0;
    used.set(`${artifact.group}/${base}`, count + 1);
    const file = join(worldRoot, artifact.group, `${count === 0 ? base : `${base}-${count + 1}`}.md`);
    await writeFile(file, renderArtifactMarkdown(artifact), "utf-8");
    written.push(file);
  }
  return written;
}
