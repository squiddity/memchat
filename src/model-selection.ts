import { type ModelRegistry } from "@earendil-works/pi-coding-agent";

export const validThinkingLevels = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;
export type ThinkingLevel = (typeof validThinkingLevels)[number];
export type PiModel = ReturnType<ModelRegistry["getAll"]>[number];

export type ModelResolution = {
  model?: PiModel;
  thinking?: ThinkingLevel;
  error?: string;
  matches?: PiModel[];
};

export function isThinkingLevel(value: string): value is ThinkingLevel {
  return validThinkingLevels.includes(value as ThinkingLevel);
}

export function modelLabel(model: PiModel): string {
  return `${model.provider}/${model.id}`;
}

export function isUsableModel(model: PiModel | undefined): model is PiModel {
  return Boolean(model && model.provider !== "unknown" && model.id !== "unknown");
}

function splitThinkingSuffix(specifier: string): { pattern: string; thinking?: ThinkingLevel } {
  const colonIndex = specifier.lastIndexOf(":");
  if (colonIndex === -1) return { pattern: specifier };

  const suffix = specifier.slice(colonIndex + 1);
  if (!isThinkingLevel(suffix)) return { pattern: specifier };
  return { pattern: specifier.slice(0, colonIndex), thinking: suffix };
}

export function resolveModel(specifier: string, modelRegistry: ModelRegistry, provider?: string): ModelResolution {
  const { pattern, thinking } = splitThinkingSuffix(specifier.trim());
  const providerSeparator = pattern.indexOf("/");
  const explicitProvider = providerSeparator === -1 ? provider : pattern.slice(0, providerSeparator);
  const modelPattern = providerSeparator === -1 ? pattern : pattern.slice(providerSeparator + 1);
  const normalizedPattern = modelPattern.toLowerCase();

  const allModels = modelRegistry.getAll();
  const providerCandidates = explicitProvider ? allModels.filter((model) => model.provider === explicitProvider) : allModels;
  if (providerCandidates.length === 0) {
    return { error: explicitProvider ? `No configured models for provider "${explicitProvider}".` : "No configured models found." };
  }

  const exactMatches = providerCandidates.filter(
    (model) => model.id.toLowerCase() === normalizedPattern || modelLabel(model).toLowerCase() === pattern.toLowerCase(),
  );
  const partialMatches = exactMatches.length > 0 ? exactMatches : providerCandidates.filter((model) => {
    const name = typeof model.name === "string" ? model.name.toLowerCase() : "";
    return model.id.toLowerCase().includes(normalizedPattern) || modelLabel(model).toLowerCase().includes(pattern.toLowerCase()) || name.includes(normalizedPattern);
  });

  if (partialMatches.length === 0) return { error: `No model matched "${specifier}".` };

  const available = modelRegistry.getAvailable();
  const availableKeys = new Set(available.map(modelLabel));
  const sorted = [...partialMatches].sort((a, b) => Number(availableKeys.has(modelLabel(b))) - Number(availableKeys.has(modelLabel(a))));
  if (sorted.length > 1 && !explicitProvider && exactMatches.length > 1) {
    return { error: `Ambiguous model "${specifier}". Use provider/model.`, matches: sorted };
  }
  return { model: sorted[0], thinking, matches: sorted };
}

export function requireResolvedModel(specifier: string, modelRegistry: ModelRegistry, provider?: string): PiModel {
  const resolved = resolveModel(specifier, modelRegistry, provider);
  if (resolved.error || !resolved.model) throw new Error(resolved.error ?? `No model matched "${specifier}".`);
  return resolved.model;
}
