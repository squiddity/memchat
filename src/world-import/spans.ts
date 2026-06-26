import type { NormalizedSourceUnit, SourceBlock } from "./types.js";

export function makeAnchor(index: number): string {
  return `b${String(index + 1).padStart(4, "0")}`;
}

export function makeBlocks(texts: string[]): SourceBlock[] {
  return texts
    .map((text) => text.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((text, index) => ({ anchor: makeAnchor(index), index, text }));
}

export function renderUnitContent(blocks: SourceBlock[]): string {
  return blocks.map((block) => `[${block.anchor}] ${block.text}`).join("\n\n");
}

export function readSlice(unit: NormalizedSourceUnit, startAnchor: string, endAnchor: string): string {
  const start = unit.blocks.findIndex((block) => block.anchor === startAnchor);
  const end = unit.blocks.findIndex((block) => block.anchor === endAnchor);
  if (start === -1) throw new Error(`Unknown start anchor ${startAnchor} for ${unit.unitId}`);
  if (end === -1) throw new Error(`Unknown end anchor ${endAnchor} for ${unit.unitId}`);
  if (end < start) throw new Error(`End anchor ${endAnchor} appears before start anchor ${startAnchor} for ${unit.unitId}`);
  return renderUnitContent(unit.blocks.slice(start, end + 1));
}
