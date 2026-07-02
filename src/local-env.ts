import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export function loadLocalEnv(cwd = process.cwd()): string | undefined {
  const envPath = resolve(cwd, ".env");
  if (!existsSync(envPath)) return undefined;

  for (const rawLine of readFileSync(envPath, "utf-8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const equalsIndex = line.indexOf("=");
    if (equalsIndex === -1) continue;

    const key = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1).trim();
    if (!key || process.env[key] !== undefined) continue;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[key] = value;
  }

  return envPath;
}

export function truthyEnv(value: string | undefined): boolean {
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

export function envToggle(key: string, defaultValue: boolean): boolean {
  const raw = process.env[key];
  return raw !== undefined ? truthyEnv(raw) : defaultValue;
}

export function reviewerProvider(specifier: string | undefined): string | undefined {
  if (!specifier) return undefined;
  const slashIndex = specifier.indexOf("/");
  return slashIndex === -1 ? undefined : specifier.slice(0, slashIndex);
}

export function providerAuthEnvKeys(provider: string | undefined): string[] {
  switch (provider) {
    case "anthropic": return ["ANTHROPIC_API_KEY"];
    case "openai": return ["OPENAI_API_KEY"];
    case "openrouter": return ["OPENROUTER_API_KEY"];
    case "lemonade": return ["MEMCHAT_LEMONADE_API_KEY", "MEMCHAT_LEMONADE_BASE_URL"];
    default: return [];
  }
}
