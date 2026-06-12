#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { stdin as input, stdout as output } from "node:process";
import readline from "node:readline/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  type PackageSource,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

const cwd = process.cwd();
const agentDir = getAgentDir();
const requireFromHere = createRequire(import.meta.url);

type MemchatPackageJson = {
  memchat?: {
    /** npm package names or local paths containing pi package resources. */
    piPackages?: string[];
  };
};

const chatSystemPrompt = `You are Memchat, a warm, internally consistent chat and fiction partner.

This is the first hello-world build of memchat. There is no long-term memory persistence yet.
During this process, only use the active session context. If asked about prior sessions, explain that persistence is not implemented yet.

Conversation priorities:
- Be conversational and concise by default.
- For fiction, invention is allowed, but maintain consistency with details already established in this session.
- If the user asks for something that depends on missing memory, ask or state uncertainty instead of fabricating continuity.
- Do not claim to have stored durable memories yet.`;

function readLocalPiPackageSpecs(): string[] {
  const packageJsonPath = resolve(cwd, "package.json");
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as MemchatPackageJson;
  const fromPackageJson = packageJson.memchat?.piPackages ?? [];
  const fromEnv = process.env.MEMCHAT_PI_PACKAGES?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];
  return [...fromPackageJson, ...fromEnv];
}

function resolveLocalPiPackage(specifier: string): string {
  if (specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("~")) {
    const expanded = specifier.startsWith("~/") ? resolve(process.env.HOME ?? cwd, specifier.slice(2)) : specifier;
    return isAbsolute(expanded) ? expanded : resolve(cwd, expanded);
  }

  try {
    return dirname(requireFromHere.resolve(`${specifier}/package.json`, { paths: [cwd] }));
  } catch {
    let entrypoint: string;
    try {
      entrypoint = requireFromHere.resolve(specifier, { paths: [cwd] });
    } catch (error) {
      throw new Error(
        `Could not resolve npm-managed pi package "${specifier}" from local node_modules. ` +
          `Install it first with: npm install ${specifier}`,
        { cause: error },
      );
    }

    let current = dirname(entrypoint);
    while (current !== dirname(current)) {
      if (existsSync(resolve(current, "package.json"))) return current;
      current = dirname(current);
    }
    throw new Error(`Could not find package root for "${specifier}".`);
  }
}

function getLocalPiPackageSources(): PackageSource[] {
  return readLocalPiPackageSpecs().map(resolveLocalPiPackage);
}

function printBanner(packageSources: PackageSource[]) {
  output.write("\nmemchat hello-world\n");
  output.write("Type a message and press Enter. Commands: /help, /plugins, /exit\n");
  output.write("Memory: in-session only unless a loaded local pi package adds it.\n");
  output.write(`Local pi packages: ${packageSources.length === 0 ? "none" : packageSources.join(", ")}\n\n`);
}

function printHelp() {
  output.write(
    `\nCommands:\n` +
      `  /help      Show this help\n` +
      `  /plugins   Show npm-managed local pi packages configured for this run\n` +
      `  /exit      End the chat\n\n` +
      `Configure local pi packages with package.json memchat.piPackages or MEMCHAT_PI_PACKAGES.\n\n`,
  );
}

async function main() {
  const packageSources = getLocalPiPackageSources();
  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: false },
    packages: packageSources,
  });

  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    noContextFiles: true,
    systemPrompt: chatSystemPrompt,
  });
  await resourceLoader.reload();

  const extensionErrors = resourceLoader.getExtensions().errors;
  for (const error of extensionErrors) {
    output.write(`[extension error] ${error.path}: ${error.error}\n`);
  }

  const { session } = await createAgentSession({
    cwd,
    agentDir,
    resourceLoader,
    settingsManager,
    sessionManager: SessionManager.inMemory(cwd),
    noTools: "builtin",
    thinkingLevel: "off",
  });

  const rl = readline.createInterface({ input, output });

  session.subscribe((event) => {
    if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
      output.write(event.assistantMessageEvent.delta);
    }
  });

  printBanner(packageSources);

  async function handleInput(line: string): Promise<boolean> {
    const text = line.trim();
    if (!text) return true;

    if (text === "/exit" || text === "/quit") return false;
    if (text === "/help") {
      printHelp();
      return true;
    }
    if (text === "/plugins") {
      output.write(
        `\nLocal pi packages:\n${packageSources.length === 0 ? "  none\n" : packageSources.map((source) => `  ${source}`).join("\n") + "\n"}\n`,
      );
      return true;
    }

    output.write("memchat> ");
    await session.prompt(text);
    output.write("\n\n");
    return true;
  }

  try {
    if (input.isTTY) {
      while (await handleInput(await rl.question("you> "))) {
        // Continue until /exit or /quit.
      }
    } else {
      for await (const line of rl) {
        output.write(`you> ${line}\n`);
        if (!(await handleInput(line))) break;
      }
    }
  } finally {
    rl.close();
    session.dispose();
  }

  output.write("bye\n");
}

main().catch((error: unknown) => {
  console.error("memchat failed:", error);
  process.exitCode = 1;
});
