import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const LEMONADE_BASE_URL = process.env.MEMCHAT_LEMONADE_BASE_URL;
const LEMONADE_API_KEY = process.env.MEMCHAT_LEMONADE_API_KEY;
const DEFAULT_CONTEXT_WINDOW = 128000;

type OpenAIModelsResponse = {
  data?: Array<{
    id?: string;
    labels?: string[];
    max_context_window?: number;
  }>;
};

type OllamaTagsResponse = {
  models?: Array<{
    name?: string;
    model?: string;
    details?: {
      families?: string[];
    };
  }>;
};

type LemonadeModel = {
  id: string;
  contextWindow?: number;
  input: ("text" | "image")[];
};

function toRootUrl(url: string): string {
  const trimmed = url.replace(/\/+$/, "");
  return trimmed.endsWith("/v1") ? trimmed.slice(0, -3) : trimmed;
}

function normalizeModelId(id: string): string {
  return id.trim().replace(/:latest$/i, "");
}

function titleCaseModel(id: string): string {
  return `${id} (Lemonade Local)`;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T | undefined> {
  try {
    const res = await fetch(url, init);
    if (!res.ok) return undefined;
    return (await res.json()) as T;
  } catch {
    return undefined;
  }
}

async function fetchModelInfos(baseUrl: string): Promise<LemonadeModel[]> {
  const trimmedBaseUrl = baseUrl.replace(/\/+$/, "");

  // Lemonade exposes an OpenAI-compatible /models endpoint with useful metadata.
  const openAiPayload = await fetchJson<OpenAIModelsResponse>(`${trimmedBaseUrl}/models`);
  const openAiModels = (openAiPayload?.data ?? [])
    .map((model) => {
      const id = model.id ? normalizeModelId(model.id) : "";
      if (!id) return undefined;
      const labels = model.labels ?? [];
      return {
        id,
        contextWindow: model.max_context_window,
        input: labels.includes("vision") ? (["text", "image"] as const) : (["text"] as const),
      };
    })
    .filter((model): model is LemonadeModel => Boolean(model));
  if (openAiModels.length > 0) return dedupeModels(openAiModels);

  // Fallback for Ollama-compatible discovery.
  const rootUrl = toRootUrl(baseUrl);
  const tagsPayload = await fetchJson<OllamaTagsResponse>(`${rootUrl}/api/tags`);
  const ollamaModels = (tagsPayload?.models ?? [])
    .map((model) => {
      const id = normalizeModelId(model.model ?? model.name ?? "");
      if (!id) return undefined;
      const families = model.details?.families ?? [];
      return {
        id,
        input: families.some((family) => family.toLowerCase().includes("vision")) ? (["text", "image"] as const) : (["text"] as const),
      };
    })
    .filter((model): model is LemonadeModel => Boolean(model));

  return dedupeModels(ollamaModels);
}

function dedupeModels(models: LemonadeModel[]): LemonadeModel[] {
  const seen = new Set<string>();
  const result: LemonadeModel[] = [];
  for (const model of models) {
    if (seen.has(model.id)) continue;
    seen.add(model.id);
    result.push(model);
  }
  return result;
}

export default async function (pi: ExtensionAPI) {
  if (!LEMONADE_BASE_URL || !LEMONADE_API_KEY) return;

  const models = await fetchModelInfos(LEMONADE_BASE_URL);

  pi.registerProvider("lemonade", {
    baseUrl: LEMONADE_BASE_URL,
    api: "openai-completions",
    apiKey: LEMONADE_API_KEY,
    compat: {
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
    },
    models: models.map((model) => {
      const contextWindow = model.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
      return {
        id: model.id,
        name: titleCaseModel(model.id),
        input: model.input,
        reasoning: false,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow,
        maxTokens: Math.floor(contextWindow / 8),
      };
    }),
  });
}
