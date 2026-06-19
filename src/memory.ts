import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";

export const memoryBackendIds = ["none", "transcript", "qmd"] as const;
export type MemoryBackendId = (typeof memoryBackendIds)[number];

export const memoryModeIds = ["none", "transcript", "qmd", "transcript-hardwired", "qmd-hardwired", "qmd-skill-retrieval", "qmd-hybrid"] as const;
export type MemoryModeId = (typeof memoryModeIds)[number];
export type MemoryPersistencePolicy = "none" | "hardwired" | "skill" | "hybrid";
export type MemoryRetrievalPolicy = "none" | "hardwired" | "skill" | "hybrid";

export type MemoryMode = {
  id: MemoryModeId;
  backend: MemoryBackendId;
  persistence: MemoryPersistencePolicy;
  retrieval: MemoryRetrievalPolicy;
  skills: Array<"qmd">;
  allowSkillTools: boolean;
  description: string;
};

export type MemoryKind = "transcript" | "summary" | "fact" | "state" | "conflict";

export type MemoryStatus = {
  id: MemoryBackendId;
  enabled: boolean;
  description: string;
  root?: string;
  sessionId?: string;
  writable?: boolean;
  notes?: string[];
};

export type MemoryInput = {
  userText: string;
};

export type MemoryHit = {
  text: string;
  source: string;
  kind: MemoryKind;
  score?: number;
  timestamp?: string;
};

export type MemoryContext = {
  text: string;
  hits: MemoryHit[];
};

export type ConversationTurn = {
  userText: string;
  assistantText: string;
  model?: string;
  timestamp: string;
};

export interface MemoryBackend {
  id: MemoryBackendId;
  status(): Promise<MemoryStatus>;
  beforePrompt(input: MemoryInput): Promise<MemoryContext>;
  afterTurn(turn: ConversationTurn): Promise<void>;
  recall(query: string): Promise<MemoryHit[]>;
  index?(): Promise<string>;
  dispose?(): Promise<void>;
}

type MemoryOptions = {
  id: MemoryBackendId;
  cwd: string;
  root?: string;
  sessionId?: string;
  maxPromptHits?: number;
};

type TranscriptRecord = {
  type: "turn";
  sessionId: string;
  timestamp: string;
  model?: string;
  user: string;
  assistant: string;
};

function sessionId(): string {
  return new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
}

function escapeJsonLine(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

function tokenize(text: string): string[] {
  return [...new Set(text.toLowerCase().match(/[\p{L}\p{N}_'-]+/gu) ?? [])].filter((token) => token.length > 1);
}

function scoreText(queryTokens: string[], text: string): number {
  const lower = text.toLowerCase();
  return queryTokens.reduce((score, token) => score + (lower.includes(token) ? 1 : 0), 0);
}

function renderContext(hits: MemoryHit[]): string {
  if (hits.length === 0) return "";
  const bullets = hits.map((hit, index) => {
    const citation = `${hit.kind}:${hit.source}${hit.timestamp ? ` @ ${hit.timestamp}` : ""}`;
    return `${index + 1}. [${citation}] ${hit.text}`;
  });
  return `Relevant remembered context:\n${bullets.join("\n")}`;
}

async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

async function walkMarkdown(root: string): Promise<string[]> {
  if (!existsSync(root)) return [];
  const entries = await readdir(root, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return walkMarkdown(path);
    if (entry.isFile() && extname(entry.name).toLowerCase() === ".md") return [path];
    return [];
  }));
  return files.flat();
}

function excerpt(text: string, queryTokens: string[], maxLength = 600): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) return compact;
  const lower = compact.toLowerCase();
  const firstHit = queryTokens.map((token) => lower.indexOf(token)).filter((index) => index >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, firstHit - Math.floor(maxLength / 3));
  const end = Math.min(compact.length, start + maxLength);
  return `${start > 0 ? "…" : ""}${compact.slice(start, end)}${end < compact.length ? "…" : ""}`;
}

class NoneMemoryBackend implements MemoryBackend {
  id = "none" as const;

  async status(): Promise<MemoryStatus> {
    return {
      id: this.id,
      enabled: false,
      description: "Memory disabled; only the active pi session context is available.",
      writable: false,
    };
  }

  async beforePrompt(): Promise<MemoryContext> {
    return { text: "", hits: [] };
  }

  async afterTurn(): Promise<void> {
    // Intentionally no-op.
  }

  async recall(): Promise<MemoryHit[]> {
    return [];
  }

  async index(): Promise<string> {
    return "none backend has nothing to index.";
  }
}

class TranscriptMemoryBackend implements MemoryBackend {
  id: MemoryBackendId = "transcript";
  protected readonly root: string;
  protected readonly sessionId: string;
  protected readonly maxPromptHits: number;

  constructor(options: MemoryOptions) {
    this.root = options.root ? resolve(options.cwd, options.root) : resolve(options.cwd, ".memchat");
    this.sessionId = options.sessionId ?? sessionId();
    this.maxPromptHits = options.maxPromptHits ?? 4;
  }

  protected get sessionsDir(): string {
    return join(this.root, "sessions");
  }

  protected get transcriptPath(): string {
    return join(this.sessionsDir, `${this.sessionId}.jsonl`);
  }

  async status(): Promise<MemoryStatus> {
    return {
      id: this.id,
      enabled: true,
      description: "Append-only JSONL transcript persistence with simple lexical recall.",
      root: this.root,
      sessionId: this.sessionId,
      writable: true,
      notes: [`Transcript: ${this.transcriptPath}`],
    };
  }

  async beforePrompt(input: MemoryInput): Promise<MemoryContext> {
    const hits = (await this.recall(input.userText)).slice(0, this.maxPromptHits);
    return { text: renderContext(hits), hits };
  }

  async afterTurn(turn: ConversationTurn): Promise<void> {
    await ensureDir(this.sessionsDir);
    const record: TranscriptRecord = {
      type: "turn",
      sessionId: this.sessionId,
      timestamp: turn.timestamp,
      model: turn.model,
      user: turn.userText,
      assistant: turn.assistantText,
    };
    await appendFile(this.transcriptPath, escapeJsonLine(record), "utf-8");
  }

  async recall(query: string): Promise<MemoryHit[]> {
    const tokens = tokenize(query);
    if (tokens.length === 0 || !existsSync(this.sessionsDir)) return [];
    const files = (await readdir(this.sessionsDir)).filter((file) => file.endsWith(".jsonl"));
    const hits: MemoryHit[] = [];

    for (const file of files) {
      const path = join(this.sessionsDir, file);
      const content = await readFile(path, "utf-8");
      for (const line of content.split(/\r?\n/)) {
        if (!line.trim()) continue;
        let record: TranscriptRecord;
        try {
          record = JSON.parse(line) as TranscriptRecord;
        } catch {
          continue;
        }
        const text = `User: ${record.user}\nAssistant: ${record.assistant}`;
        const score = scoreText(tokens, text);
        if (score <= 0) continue;
        hits.push({
          text: excerpt(text, tokens),
          source: join(".memchat", "sessions", file),
          kind: "transcript",
          score,
          timestamp: record.timestamp,
        });
      }
    }

    return hits.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || String(b.timestamp).localeCompare(String(a.timestamp))).slice(0, 10);
  }

  async index(): Promise<string> {
    await ensureDir(this.sessionsDir);
    return "transcript backend uses JSONL directly; no separate index is required.";
  }
}

class QmdMemoryBackend extends TranscriptMemoryBackend {
  id = "qmd" as const;

  private get memoryDir(): string {
    return join(this.root, "memory");
  }

  private get summariesDir(): string {
    return join(this.memoryDir, "summaries");
  }

  async status(): Promise<MemoryStatus> {
    return {
      id: this.id,
      enabled: true,
      description: "Markdown memory notes under .memchat/memory with qmd-shaped lexical recall; JSONL transcript is also retained.",
      root: this.root,
      sessionId: this.sessionId,
      writable: true,
      notes: [
        `Transcript: ${this.transcriptPath}`,
        `Markdown source: ${this.memoryDir}`,
        "Hardwired qmd recall currently uses lexical search over markdown; qmd skill modes can use the @tobilu/qmd CLI for model-centric retrieval.",
      ],
    };
  }

  override async beforePrompt(input: MemoryInput): Promise<MemoryContext> {
    const hits = (await this.recall(input.userText)).slice(0, this.maxPromptHits);
    return { text: renderContext(hits), hits };
  }

  override async afterTurn(turn: ConversationTurn): Promise<void> {
    await super.afterTurn(turn);
    await ensureDir(this.summariesDir);
    await this.ensureSeedFiles();
    const day = turn.timestamp.slice(0, 10);
    const summaryPath = join(this.summariesDir, `${day}.md`);
    const entry = [
      `\n## ${turn.timestamp}`,
      "",
      `- User: ${turn.userText.replace(/\n/g, " ")}`,
      `- Assistant: ${turn.assistantText.replace(/\n/g, " ")}`,
    ].join("\n");
    await appendFile(summaryPath, `${entry}\n`, "utf-8");
  }

  override async recall(query: string): Promise<MemoryHit[]> {
    const tokens = tokenize(query);
    if (tokens.length === 0) return [];
    await this.ensureSeedFiles();
    const markdownHits = await this.searchMarkdown(tokens);
    const transcriptHits = await super.recall(query);
    return [...markdownHits, ...transcriptHits]
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || String(b.timestamp).localeCompare(String(a.timestamp)))
      .slice(0, 10);
  }

  override async index(): Promise<string> {
    await this.ensureSeedFiles();
    const files = await walkMarkdown(this.memoryDir);
    return `indexed ${files.length} markdown memory file(s) for lexical qmd-compatible recall.`;
  }

  private async ensureSeedFiles(): Promise<void> {
    await ensureDir(this.summariesDir);
    const seedFiles: Array<[string, string]> = [
      ["facts.md", "# Facts\n\nStable extracted facts can be added here.\n"],
      ["state.md", "# Current State\n\nCurrent world/chat state snapshot can be added here.\n"],
      ["conflicts.md", "# Conflicts and Retcons\n\nConflicting claims and intentional retcons can be tracked here.\n"],
    ];
    for (const [name, content] of seedFiles) {
      const path = join(this.memoryDir, name);
      if (!existsSync(path)) await writeFile(path, content, "utf-8");
    }
  }

  private async searchMarkdown(tokens: string[]): Promise<MemoryHit[]> {
    const files = await walkMarkdown(this.memoryDir);
    const hits: MemoryHit[] = [];
    for (const path of files) {
      const content = await readFile(path, "utf-8");
      const score = scoreText(tokens, content);
      if (score <= 0) continue;
      const relative = path.slice(resolve(this.root, "..").length + 1);
      const kind = this.kindForMarkdown(path);
      const stats = await stat(path);
      hits.push({
        text: excerpt(content, tokens),
        source: relative,
        kind,
        score,
        timestamp: stats.mtime.toISOString(),
      });
    }
    return hits;
  }

  private kindForMarkdown(path: string): MemoryKind {
    const name = basename(path).toLowerCase();
    if (name === "facts.md") return "fact";
    if (name === "state.md") return "state";
    if (name === "conflicts.md") return "conflict";
    return "summary";
  }
}

export function isMemoryBackendId(value: string): value is MemoryBackendId {
  return (memoryBackendIds as readonly string[]).includes(value);
}

export function isMemoryModeId(value: string): value is MemoryModeId {
  return (memoryModeIds as readonly string[]).includes(value);
}

export function resolveMemoryMode(value: MemoryModeId): MemoryMode {
  if (value === "none") {
    return {
      id: value,
      backend: "none",
      persistence: "none",
      retrieval: "none",
      skills: [],
      allowSkillTools: false,
      description: "No durable memory; active pi session context only.",
    };
  }
  if (value === "transcript" || value === "transcript-hardwired") {
    return {
      id: value,
      backend: "transcript",
      persistence: "hardwired",
      retrieval: "hardwired",
      skills: [],
      allowSkillTools: false,
      description: "Hardwired JSONL transcript persistence with hardwired lexical retrieval.",
    };
  }
  if (value === "qmd" || value === "qmd-hardwired") {
    return {
      id: value,
      backend: "qmd",
      persistence: "hardwired",
      retrieval: "hardwired",
      skills: [],
      allowSkillTools: false,
      description: "Hardwired markdown/qmd-shaped persistence with hardwired lexical retrieval.",
    };
  }
  if (value === "qmd-skill-retrieval") {
    return {
      id: value,
      backend: "qmd",
      persistence: "hardwired",
      retrieval: "skill",
      skills: ["qmd"],
      allowSkillTools: true,
      description: "Hardwired markdown/qmd-shaped persistence; model-centric retrieval via the qmd skill.",
    };
  }
  return {
    id: value,
    backend: "qmd",
    persistence: "hardwired",
    retrieval: "hybrid",
    skills: ["qmd"],
    allowSkillTools: true,
    description: "Hardwired markdown/qmd-shaped persistence and recall plus optional model-centric qmd skill retrieval.",
  };
}

export function createMemoryBackend(options: MemoryOptions): MemoryBackend {
  if (options.id === "none") return new NoneMemoryBackend();
  if (options.id === "transcript") return new TranscriptMemoryBackend(options);
  return new QmdMemoryBackend(options);
}
