import type { NormalizedSourceUnit, SourceBlock, SourceBlockKind } from "./types.js";

export type SourceBlockInput = string | {
  text: string;
  kind?: SourceBlockKind;
  sourceTag?: string;
  sourceClass?: string;
};

export function makeAnchor(index: number): string {
  return `b${String(index + 1).padStart(4, "0")}`;
}

export function normalizeSourceBlockText(text: string, preserveLines: boolean): string {
  if (!preserveLines) return text.replace(/\s+/g, " ").trim();
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[\t ]+/g, " ").trimEnd())
    .join("\n")
    .replace(/^\n+|\n+$/g, "")
    .replace(/\n{3,}/g, "\n\n");
}

export function makeBlocks(inputs: SourceBlockInput[]): SourceBlock[] {
  return inputs
    .map((input) => typeof input === "string" ? { text: input } : input)
    .map((input) => {
      const preserveLines = input.kind === "pre" || input.kind === "poem";
      return { ...input, text: normalizeSourceBlockText(input.text, preserveLines) };
    })
    .filter((input) => input.text.length > 0)
    .map((input, index) => ({
      anchor: makeAnchor(index),
      index,
      text: input.text,
      ...(input.kind ? { kind: input.kind } : {}),
      ...(input.sourceTag ? { sourceTag: input.sourceTag } : {}),
      ...(input.sourceClass ? { sourceClass: input.sourceClass } : {}),
    }));
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
