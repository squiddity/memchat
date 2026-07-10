#!/usr/bin/env node

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { access, chmod, lstat, mkdtemp, realpath, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { argv, exit, stderr, stdout } from "node:process";
import { pathToFileURL } from "node:url";

export type ReviewOptions = { root: string; help?: boolean };
export type TailscaleIdentity = { address: string; dnsName: string };
export type ReviewDependencies = {
  discoverTailscale?: () => TailscaleIdentity;
  mdtsBinary?: string;
  onUrl?: (url: string) => void;
  onChildStarted?: (child: ChildProcess) => void;
};

export function usage(): string {
  return "Usage: memchat-markdown-review [repository-contained-markdown-directory]\n\n" +
    "Starts a temporary mdts viewer bound only to this host's Tailscale IPv4 address.\n" +
    "Defaults to world-output/. Stop the supervised viewer when review is complete.\n";
}

export function parseArgs(args: string[]): ReviewOptions {
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) return { root: "world-output", help: true };
  if (args.length === 0) return { root: "world-output" };
  if (args.length === 1 && !args[0].startsWith("-")) return { root: args[0] };
  throw new Error(`Unknown or incomplete option.\n\n${usage()}`);
}

function isContained(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

export async function resolveReviewRoot(repositoryRoot: string, requestedRoot: string): Promise<string> {
  const realRepositoryRoot = await realpath(repositoryRoot);
  const requestedPath = resolve(realRepositoryRoot, requestedRoot);
  if (!isContained(realRepositoryRoot, requestedPath)) throw new Error("Requested review root is outside the repository.");

  let root: string;
  try {
    root = await realpath(requestedPath);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error(`Requested review root does not exist: ${requestedRoot}`);
    throw error;
  }
  if (!isContained(realRepositoryRoot, root)) throw new Error("Requested review root resolves outside the repository.");
  if (!(await lstat(root)).isDirectory()) throw new Error(`Requested review root is not a directory: ${requestedRoot}`);
  return root;
}

function validTailscaleIpv4(value: string): boolean {
  const parts = value.trim().split(".").map(Number);
  return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) && parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127;
}

function validTailscaleDnsName(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9][a-z0-9.-]*\.ts\.net\.?$/i.test(value);
}

export function discoverTailscale(tailscaleBinary = "tailscale"): TailscaleIdentity {
  const ip = spawnSync(tailscaleBinary, ["ip", "-4"], { encoding: "utf8" });
  if (ip.error || ip.status !== 0) throw new Error("Tailscale IPv4 address is unavailable; refusing to start a review server.");
  const address = ip.stdout.trim().split(/\s+/)[0] ?? "";
  if (!validTailscaleIpv4(address)) throw new Error("Tailscale did not provide a trusted IPv4 address; refusing to start a review server.");

  const status = spawnSync(tailscaleBinary, ["status", "--json"], { encoding: "utf8" });
  if (status.error || status.status !== 0) throw new Error("Tailscale DNS name is unavailable; refusing to start a review server.");
  let payload: { Self?: { DNSName?: unknown } };
  try {
    payload = JSON.parse(status.stdout) as { Self?: { DNSName?: unknown } };
  } catch {
    throw new Error("Tailscale status output was malformed; refusing to start a review server.");
  }
  const dnsName = payload.Self?.DNSName;
  if (!validTailscaleDnsName(dnsName)) throw new Error("Tailscale did not provide a trusted DNS name; refusing to start a review server.");
  return { address, dnsName: dnsName.replace(/\.$/, "") };
}

export function tailscaleUrlFromStartup(output: string, dnsName: string): string | undefined {
  const plainOutput = output
    .replace(/\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)/g, "")
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "");
  const match = plainOutput.match(/Server running at http:\/\/[^\s/:]+:(\d+)(\/[^\s]*)?/);
  if (!match) return undefined;
  const port = Number(match[1]);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return undefined;
  return `http://${dnsName}:${port}${match[2] ?? ""}`;
}

async function createRuntimeHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "memchat-markdown-review-"));
  await chmod(home, 0o700);
  return home;
}

function installedMdts(repositoryRoot: string): string {
  return join(repositoryRoot, "node_modules", ".bin", "mdts");
}

async function waitForExit(child: ChildProcess): Promise<number> {
  return await new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolveExit(code ?? 0));
  });
}

export async function runReview(
  options: ReviewOptions,
  repositoryRoot = resolve(dirname(new URL(import.meta.url).pathname), ".."),
  dependencies: ReviewDependencies = {},
): Promise<void> {
  const root = await resolveReviewRoot(repositoryRoot, options.root);
  const tailscale = dependencies.discoverTailscale?.() ?? discoverTailscale();
  const mdts = dependencies.mdtsBinary ?? installedMdts(repositoryRoot);
  try {
    await access(mdts, constants.X_OK);
  } catch {
    throw new Error("Installed mdts binary is unavailable; run npm install before starting review.");
  }

  const runtimeHome = await createRuntimeHome();
  let child: ChildProcess | undefined;
  let startup = "";
  let announced = false;
  const forwardSignal = (signal: NodeJS.Signals) => child?.kill(signal);
  const onSigterm = () => forwardSignal("SIGTERM");
  const onSigint = () => forwardSignal("SIGINT");
  process.once("SIGTERM", onSigterm);
  process.once("SIGINT", onSigint);

  try {
    child = spawn(mdts, ["--no-open", "--host", tailscale.address, "--port", "auto", root], {
      cwd: root,
      env: { ...process.env, HOME: runtimeHome, USERPROFILE: runtimeHome },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const report = (chunk: Buffer) => {
      const text = chunk.toString();
      stderr.write(text);
      startup += text;
      if (!announced) {
        const url = tailscaleUrlFromStartup(startup, tailscale.dnsName);
        if (url) {
          announced = true;
          stdout.write(`Markdown review URL: ${url}\n`);
          dependencies.onUrl?.(url);
        }
      }
    };
    child.stdout?.on("data", report);
    child.stderr?.on("data", report);
    dependencies.onChildStarted?.(child);
    const code = await waitForExit(child);
    if (code !== 0) throw new Error(`mdts exited with code ${code}.`);
  } finally {
    process.removeListener("SIGTERM", onSigterm);
    process.removeListener("SIGINT", onSigint);
    if (child && !child.killed) child.kill("SIGTERM");
    await rm(runtimeHome, { recursive: true, force: true });
  }
}

export async function main(args = argv.slice(2)): Promise<void> {
  const options = parseArgs(args);
  if (options.help) {
    stdout.write(usage());
    return;
  }
  await runReview(options);
}

if (argv[1] && import.meta.url === pathToFileURL(argv[1]).href) {
  main().catch((error: unknown) => {
    stderr.write(`memchat-markdown-review failed: ${error instanceof Error ? error.message : String(error)}\n`);
    exit(1);
  });
}
