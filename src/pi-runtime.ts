import { resolve } from "node:path";

export type PiRuntimePaths = {
  /** Isolated pi config and resource root for this project invocation. */
  agentDir: string;
  /** Project-local custom model definitions. */
  modelsPath: string;
  /** Project-local credentials unless explicitly overridden. */
  authPath: string;
};

/**
 * Keep embedded pi sessions hermetic. Account-level pi resources are never
 * discovered; credentials may be opted into through an explicit file path.
 */
export function resolvePiRuntimePaths(options: { cwd?: string; authFile?: string } = {}): PiRuntimePaths {
  const cwd = resolve(options.cwd ?? process.cwd());
  const agentDir = resolve(cwd, ".memchat", "pi");
  const configuredAuthFile = options.authFile ?? process.env.MEMCHAT_PI_AUTH_FILE;
  return {
    agentDir,
    modelsPath: resolve(agentDir, "models.json"),
    authPath: configuredAuthFile ? resolve(cwd, configuredAuthFile) : resolve(agentDir, "auth.json"),
  };
}
