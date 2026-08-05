#!/usr/bin/env node

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { access, chmod, copyFile, lstat, mkdir, mkdtemp, readdir, realpath, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { argv, exit, stderr, stdout } from "node:process";
import { pathToFileURL } from "node:url";
import { assertNoSymlinkedPathComponents } from "./mem-import/path-safety.js";
import { readProjectionOwnership } from "./mem-import/projection-ownership.js";

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
    "Defaults to compendium-output/. Stop the supervised viewer when review is complete.\n";
}

export function parseArgs(args: string[]): ReviewOptions {
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) return { root: "compendium-output", help: true };
  if (args.length === 0) return { root: "compendium-output" };
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
  // Do not normalize a symlinked requested path into an apparently safe root;
  // the mirror must have a regular, repository-contained source tree.
  try {
    await assertNoSymlinkedPathComponents(requestedPath, {
      requireDirectories: true,
      onSymlink: (path) => new Error(`Requested review root contains a symlinked path component: ${path}`),
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("symlinked")) {
      try {
        const linkedRoot = await realpath(requestedPath);
        if (!isContained(realRepositoryRoot, linkedRoot)) throw new Error("Requested review root resolves outside the repository.");
      } catch (linkedError) {
        if (linkedError instanceof Error && linkedError.message.includes("outside the repository")) throw linkedError;
      }
    }
    throw error;
  }

  let root: string;
  try {
    root = await realpath(requestedPath);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error(`Requested review root does not exist: ${requestedRoot}`);
    throw error;
  }
  if (!isContained(realRepositoryRoot, root)) throw new Error("Requested review root resolves outside the repository.");
  const info = await lstat(root);
  if (info.isSymbolicLink()) throw new Error(`Requested review root is symlinked: ${requestedRoot}`);
  if (!info.isDirectory()) throw new Error(`Requested review root is not a directory: ${requestedRoot}`);
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

async function collectMarkdownFiles(sourceRoot: string, relativeDirectory = ""): Promise<string[]> {
  const directory = relativeDirectory ? join(sourceRoot, relativeDirectory) : sourceRoot;
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const relativePath = relativeDirectory ? join(relativeDirectory, entry.name) : entry.name;
    const sourcePath = join(sourceRoot, relativePath);
    const info = await lstat(sourcePath);
    if (info.isSymbolicLink()) throw new Error(`Markdown review source contains a symlink: ${relativePath}`);
    if (info.isDirectory()) files.push(...await collectMarkdownFiles(sourceRoot, relativePath));
    else if (info.isFile() && /\.md$/i.test(entry.name)) files.push(relativePath);
    else if (!info.isFile()) throw new Error(`Markdown review source contains a non-regular file: ${relativePath}`);
  }
  return files.sort();
}

/** Build a temporary tree containing Markdown only; mdts never receives the source root. */
export async function createMarkdownMirror(sourceRoot: string): Promise<string> {
  const root = resolve(sourceRoot);
  const rootInfo = await lstat(root);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) throw new Error("Markdown review source root must be a regular directory");
  await assertNoSymlinkedPathComponents(root, {
    onSymlink: (path) => new Error(`Markdown review source contains a symlinked path component: ${path}`),
    requireDirectories: true,
  });
  const allMarkdown = await collectMarkdownFiles(root);
  const ownership = await readProjectionOwnership(root);
  const selected = ownership ? ownership.files : allMarkdown;
  if (ownership) {
    const selectedSet = new Set(selected);
    if (selected.some((file) => !/\.md$/i.test(file))) throw new Error("Projection ownership manifest contains a non-Markdown file");
    for (const relativePath of selected) {
      const target = resolve(root, relativePath);
      if (!isContained(root, target)) throw new Error(`Projection ownership escapes review root: ${relativePath}`);
      const info = await lstat(target);
      if (info.isSymbolicLink() || !info.isFile()) throw new Error(`Owned projection file is not a regular Markdown file: ${relativePath}`);
    }
    // An ownership manifest is authoritative: do not silently omit a declared
    // generated page, even if an interrupted projection removed it.
    for (const relativePath of selectedSet) if (!allMarkdown.includes(relativePath)) throw new Error(`Owned projection Markdown file is missing: ${relativePath}`);
  }
  const mirror = await mkdtemp(join(tmpdir(), "memchat-markdown-mirror-"));
  try {
    await chmod(mirror, 0o700);
    for (const relativePath of selected) {
      const destination = join(mirror, relativePath);
      await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
      const info = await lstat(join(root, relativePath));
      if (info.isSymbolicLink() || !info.isFile()) throw new Error(`Markdown review source changed to a non-regular file: ${relativePath}`);
      await copyFile(join(root, relativePath), destination);
    }
    return mirror;
  } catch (error) {
    await rm(mirror, { recursive: true, force: true });
    throw error;
  }
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

  const mirror = await createMarkdownMirror(root);
  let runtimeHome: string;
  try {
    runtimeHome = await createRuntimeHome();
  } catch (error) {
    await rm(mirror, { recursive: true, force: true });
    throw error;
  }
  let child: ChildProcess | undefined;
  let startup = "";
  let announced = false;
  const forwardSignal = (signal: NodeJS.Signals) => child?.kill(signal);
  const onSigterm = () => forwardSignal("SIGTERM");
  const onSigint = () => forwardSignal("SIGINT");
  process.once("SIGTERM", onSigterm);
  process.once("SIGINT", onSigint);

  try {
    child = spawn(mdts, ["--no-open", "--host", tailscale.address, "--port", "auto", mirror], {
      cwd: mirror,
      env: { ...process.env, HOME: runtimeHome, USERPROFILE: runtimeHome },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const report = (chunk: Buffer) => {
      const text = chunk.toString();
      stderr.write(text);
      if (!announced) {
        startup += text;
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
    await rm(mirror, { recursive: true, force: true });
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
