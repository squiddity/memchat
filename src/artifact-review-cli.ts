#!/usr/bin/env node

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { argv, exit, stderr, stdout } from "node:process";
import { pathToFileURL } from "node:url";
import { discoverTailscale, resolveReviewRoot, type TailscaleIdentity } from "./markdown-review-cli.js";

export type ArtifactReviewOptions = { root: string; port: number; help?: boolean };
export type ArtifactReviewDependencies = {
  discoverTailscale?: () => TailscaleIdentity;
  viewerBundle?: string;
  onUrl?: (url: string) => void;
  onServerStarted?: (server: Server) => void;
};

type TreeEntry = {
  name: string;
  path: string;
  type: "directory" | "file";
  children?: TreeEntry[];
  bytes?: number;
};

const DEFAULT_ROOT = ".memchat-agent-testing/output";
const DEFAULT_PORT = 8522;
const MAX_FILE_BYTES = 50 * 1024 * 1024;

export function usage(): string {
  return "Usage: memchat-artifact-review [repository-contained-artifact-directory] [--port <1-65535>]\n\n" +
    "Starts a temporary read-only JSON artifact viewer bound only to this host's Tailscale IPv4 address.\n" +
    `Defaults to ${DEFAULT_ROOT}/ on port ${DEFAULT_PORT}. Stop the supervised viewer when review is complete.\n`;
}

function parsePort(value: string | undefined): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(`--port must be an integer between 1 and 65535.\n\n${usage()}`);
  return port;
}

export function parseArgs(args: string[]): ArtifactReviewOptions {
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) return { root: DEFAULT_ROOT, port: DEFAULT_PORT, help: true };
  let root = DEFAULT_ROOT;
  let rootSpecified = false;
  let port = DEFAULT_PORT;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--port" || arg === "-p") {
      port = parsePort(args[++index]);
    } else if (!arg.startsWith("-") && !rootSpecified) {
      root = arg;
      rootSpecified = true;
    } else {
      throw new Error(`Unknown or incomplete option.\n\n${usage()}`);
    }
  }
  return { root, port };
}

function isContained(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

function safeRelativePath(root: string, requested: string): string | undefined {
  if (!requested || requested.includes("\0")) return undefined;
  const candidate = resolve(root, requested);
  if (!isContained(root, candidate)) return undefined;
  const relativePath = relative(root, candidate);
  return relativePath && !relativePath.startsWith("..") ? relativePath : undefined;
}

async function listTree(root: string, relativeDirectory = ""): Promise<TreeEntry[]> {
  const directory = join(root, relativeDirectory);
  const entries = await readdir(directory, { withFileTypes: true });
  const tree: TreeEntry[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.isSymbolicLink() || entry.name.startsWith(".")) continue;
    const relativePath = relativeDirectory ? join(relativeDirectory, entry.name) : entry.name;
    if (entry.isDirectory()) {
      tree.push({ name: entry.name, path: relativePath, type: "directory", children: await listTree(root, relativePath) });
      continue;
    }
    if (entry.isFile() && extname(entry.name).toLowerCase() === ".json") {
      const info = await lstat(join(root, relativePath));
      tree.push({ name: entry.name, path: relativePath, type: "file", bytes: info.size });
    }
  }
  return tree;
}

function send(response: ServerResponse, status: number, body: string, contentType: string): void {
  response.writeHead(status, {
    "content-type": contentType,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
  });
  response.end(body);
}

function html(): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Memchat artifact review</title>
<style>
:root { color-scheme: dark; font-family: ui-sans-serif, system-ui, sans-serif; background: #111827; color: #e5e7eb; }
body { margin: 0; display: grid; grid-template-columns: minmax(230px, 28%) 1fr; height: 100vh; overflow: hidden; }
nav { overflow: auto; border-right: 1px solid #374151; padding: 1rem; } main { display: grid; grid-template-rows: auto minmax(0, 1fr); min-width: 0; min-height: 0; }
header { display:flex; gap: .75rem; align-items:center; border-bottom: 1px solid #374151; padding: .75rem 1rem; }
#title { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; } #editor, #editor > * { min-width: 0; min-height: 0; height: 100%; } #editor { overflow: hidden;
  --jse-theme: dark; --jse-theme-color: #60a5fa; --jse-theme-color-highlight: #93c5fd;
  --jse-background-color: #111827; --jse-text-color: #e5e7eb; --jse-text-color-inverse: #9ca3af;
  --jse-main-border: 1px solid #374151; --jse-menu-color: #e5e7eb; --jse-modal-background: #1f2937; --jse-modal-overlay-background: rgba(3, 7, 18, .72); --jse-modal-code-background: #111827;
  --jse-panel-background: #1f2937; --jse-panel-background-border: 1px solid #374151; --jse-panel-color: #e5e7eb; --jse-panel-color-readonly: #9ca3af; --jse-panel-border: 1px solid #374151; --jse-panel-button-color-highlight: #f9fafb; --jse-panel-button-background-highlight: #374151;
  --jse-navigation-bar-background: #1f2937; --jse-navigation-bar-background-highlight: #374151; --jse-navigation-bar-dropdown-color: #e5e7eb;
  --jse-context-menu-background: #1f2937; --jse-context-menu-background-highlight: #374151; --jse-context-menu-separator-color: #374151; --jse-context-menu-color: #e5e7eb; --jse-context-menu-pointer-background: #4b5563; --jse-context-menu-pointer-background-highlight: #6b7280; --jse-context-menu-pointer-color: #e5e7eb;
  --jse-key-color: #93c5fd; --jse-value-color: #e5e7eb; --jse-value-color-number: #c4b5fd; --jse-value-color-boolean: #67e8f9; --jse-value-color-null: #67e8f9; --jse-value-color-string: #a7f3d0; --jse-value-color-url: #a7f3d0; --jse-delimiter-color: #9ca3af; --jse-edit-outline: 2px solid #93c5fd;
  --jse-selection-background-color: #374151; --jse-selection-background-inactive-color: #1f2937; --jse-hover-background-color: #1f2937; --jse-active-line-background-color: rgba(96, 165, 250, .08); --jse-search-match-background-color: #713f12;
  --jse-table-header-background: #1f2937; --jse-table-header-background-highlight: #374151; --jse-table-row-odd-background: rgba(255,255,255,.035);
  --jse-input-background: #111827; --jse-input-border: 1px solid #4b5563; --jse-button-background: #2563eb; --jse-button-background-highlight: #3b82f6; --jse-button-color: #f9fafb; --jse-button-secondary-background: #374151; --jse-button-secondary-background-highlight: #4b5563; --jse-button-secondary-background-disabled: #6b7280; --jse-button-secondary-color: #e5e7eb; --jse-a-color: #93c5fd; --jse-a-color-highlight: #bfdbfe;
  --jse-svelte-select-background: #111827; --jse-svelte-select-border: 1px solid #4b5563; --list-background: #1f2937; --item-hover-bg: #374151; --input-color: #e5e7eb; --list-shadow: 0 2px 8px rgba(0,0,0,.5); }
button, select { background:#1f2937; border:1px solid #4b5563; color:#e5e7eb; border-radius:.25rem; padding:.25rem .5rem; }
.tree { list-style:none; padding-left: .9rem; margin:.25rem 0; } .tree.root { padding-left:0; } .file { width:100%; text-align:left; border:0; background:transparent; padding:.2rem; font:inherit; color:#bfdbfe; } .file:hover { background:#1f2937; } .dir { color:#d1d5db; font-weight:600; } .meta { color:#9ca3af; font-size:.85rem; }
</style></head><body>
<nav><h1>Artifact JSON</h1><p class="meta">Read-only JSON files under the mounted output root.</p><div id="tree"></div></nav>
<main><header><strong id="title">Choose a JSON artifact</strong><label>View <select id="mode"><option value="tree">Tree</option><option value="text">Raw</option><option value="table">Table</option></select></label></header><div id="editor"></div></main>
<script type="module">
import { createJSONEditor } from '/vendor/vanilla-jsoneditor.js';
const editor = createJSONEditor({ target: document.getElementById('editor'), props: { content: { json: {} }, mode: 'tree', readOnly: true, mainMenuBar: false, navigationBar: true, statusBar: true } });
const title = document.getElementById('title');
const formatBytes = (bytes) => bytes < 1024 ? bytes + ' B' : (bytes / 1024).toFixed(1) + ' KB';
async function openFile(path) {
  const response = await fetch('/api/file?path=' + encodeURIComponent(path));
  if (!response.ok) throw new Error(await response.text());
  const payload = await response.json();
  editor.updateProps({ content: { text: payload.text } });
  title.textContent = payload.path + ' · ' + formatBytes(payload.bytes);
}
function render(entries) {
  const list = document.createElement('ul'); list.className = 'tree';
  for (const entry of entries) {
    const item = document.createElement('li');
    if (entry.type === 'directory') { const label = document.createElement('span'); label.className = 'dir'; label.textContent = entry.name + '/'; item.append(label); item.append(render(entry.children)); }
    else { const button = document.createElement('button'); button.className = 'file'; button.textContent = entry.name; button.title = entry.path; button.onclick = () => openFile(entry.path).catch(error => { title.textContent = String(error); }); item.append(button); }
    list.append(item);
  }
  return list;
}
document.getElementById('mode').onchange = (event) => editor.updateProps({ mode: event.target.value });
const treeResponse = await fetch('/api/tree');
document.getElementById('tree').replaceChildren(render((await treeResponse.json()).entries));
</script></body></html>`;
}

async function handleRequest(root: string, request: IncomingMessage, response: ServerResponse, viewerBundle: string): Promise<void> {
  const url = new URL(request.url ?? "/", "http://artifact-review.local");
  if (request.method !== "GET") return send(response, 405, "Method not allowed", "text/plain; charset=utf-8");
  if (url.pathname === "/") return send(response, 200, html(), "text/html; charset=utf-8");
  if (url.pathname === "/vendor/vanilla-jsoneditor.js") {
    return send(response, 200, await readFile(viewerBundle, "utf-8"), "text/javascript; charset=utf-8");
  }
  if (url.pathname === "/api/tree") return send(response, 200, JSON.stringify({ entries: await listTree(root) }), "application/json; charset=utf-8");
  if (url.pathname === "/api/file") {
    const relativePath = safeRelativePath(root, url.searchParams.get("path") ?? "");
    if (!relativePath || extname(relativePath).toLowerCase() !== ".json") return send(response, 400, "Invalid artifact path", "text/plain; charset=utf-8");
    const file = join(root, relativePath);
    const info = await lstat(file).catch(() => undefined);
    if (!info?.isFile() || info.size > MAX_FILE_BYTES) return send(response, 404, "Artifact is unavailable", "text/plain; charset=utf-8");
    return send(response, 200, JSON.stringify({ path: relativePath, bytes: info.size, text: await readFile(file, "utf-8") }), "application/json; charset=utf-8");
  }
  return send(response, 404, "Not found", "text/plain; charset=utf-8");
}

function viewerBundle(repositoryRoot: string): string {
  return join(repositoryRoot, "node_modules", "vanilla-jsoneditor", "standalone.js");
}

export async function runArtifactReview(
  options: ArtifactReviewOptions,
  repositoryRoot = resolve(dirname(new URL(import.meta.url).pathname), ".."),
  dependencies: ArtifactReviewDependencies = {},
): Promise<void> {
  const root = await resolveReviewRoot(repositoryRoot, options.root);
  const bundle = dependencies.viewerBundle ?? viewerBundle(repositoryRoot);
  const bundleInfo = await lstat(bundle).catch(() => undefined);
  if (!bundleInfo?.isFile()) throw new Error("Installed vanilla-jsoneditor bundle is unavailable; run npm install before starting review.");
  const tailscale = dependencies.discoverTailscale?.() ?? discoverTailscale();
  const server = createServer((request, response) => {
    handleRequest(root, request, response, bundle).catch((error: unknown) => {
      send(response, 500, `Artifact review error: ${error instanceof Error ? error.message : String(error)}`, "text/plain; charset=utf-8");
    });
  });
  const forwardSignal = () => server.close();
  process.once("SIGTERM", forwardSignal);
  process.once("SIGINT", forwardSignal);
  try {
    await new Promise<void>((resolveStarted, reject) => {
      server.once("error", reject);
      server.listen(options.port, tailscale.address, () => {
        server.off("error", reject);
        const address = server.address();
        if (!address || typeof address === "string") return reject(new Error("Artifact review server did not expose a TCP port."));
        const url = `http://${tailscale.dnsName}:${address.port}`;
        stdout.write(`Artifact review URL: ${url}\n`);
        dependencies.onUrl?.(url);
        dependencies.onServerStarted?.(server);
        resolveStarted();
      });
    });
    await new Promise<void>((resolveClosed) => server.once("close", resolveClosed));
  } finally {
    process.removeListener("SIGTERM", forwardSignal);
    process.removeListener("SIGINT", forwardSignal);
    if (server.listening) server.close();
  }
}

export async function main(args = argv.slice(2)): Promise<void> {
  const options = parseArgs(args);
  if (options.help) {
    stdout.write(usage());
    return;
  }
  await runArtifactReview(options);
}

if (argv[1] && import.meta.url === pathToFileURL(argv[1]).href) {
  main().catch((error: unknown) => {
    stderr.write(`memchat-artifact-review failed: ${error instanceof Error ? error.message : String(error)}\n`);
    exit(1);
  });
}
