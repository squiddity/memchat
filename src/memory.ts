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

export type MemoryDebugEvent = {
  operation: "recall" | "before-prompt" | "write" | "index" | "synthesize" | "compact";
  backend: MemoryBackendId;
  detail: string;
  query?: string;
  hits?: number;
  source?: string;
};

export type ConversationTurn = {
  userText: string;
  assistantText: string;
  model?: string;
  timestamp: string;
};

export type MemoryFileSnapshot = {
  facts: string;
  state: string;
  conflicts: string;
  recentSummary: string;
};

export type MemorySynthesis = {
  summaryBullets: string[];
  facts: string[];
  state: string[];
  conflicts: string[];
};

export type MemoryCompaction = {
  summaryMarkdown: string;
  factsMarkdown?: string;
  stateMarkdown?: string;
  conflictsMarkdown?: string;
};

export type MemorySynthesisProvider = {
  label: string;
  synthesizeTurn(input: {
    turn: ConversationTurn;
    sessionId: string;
    transcriptSource: string;
    memory: MemoryFileSnapshot;
  }): Promise<MemorySynthesis | undefined>;
  compactSession?(input: {
    sessionId: string;
    transcriptSource: string;
    memory: MemoryFileSnapshot;
    sessionSummary: string;
  }): Promise<MemoryCompaction | undefined>;
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
  synthesisProvider?: MemorySynthesisProvider;
  onDebug?: (event: MemoryDebugEvent) => void;
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
  return new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 17);
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

function normalizeMarkdown(markdown: string): string {
  return `${markdown.trim()}\n`;
}

function asBullets(items: string[]): string {
  return items.map((item) => `- ${item.replace(/\s+/g, " ").trim()}`).join("\n");
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
  protected readonly synthesisProvider: MemorySynthesisProvider | undefined;
  protected readonly onDebug: ((event: MemoryDebugEvent) => void) | undefined;

  constructor(options: MemoryOptions) {
    this.root = options.root ? resolve(options.cwd, options.root) : resolve(options.cwd, ".memchat");
    this.sessionId = options.sessionId ?? sessionId();
    this.maxPromptHits = options.maxPromptHits ?? 4;
    this.synthesisProvider = options.synthesisProvider;
    this.onDebug = options.onDebug;
  }

  protected debug(event: Omit<MemoryDebugEvent, "backend">): void {
    this.onDebug?.({ backend: this.id, ...event });
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
    this.debug({ operation: "before-prompt", detail: `preparing memory context with up to ${this.maxPromptHits} hit(s)`, query: input.userText });
    const hits = (await this.recall(input.userText)).slice(0, this.maxPromptHits);
    this.debug({ operation: "before-prompt", detail: `injecting ${hits.length} remembered context hit(s)`, query: input.userText, hits: hits.length });
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
    this.debug({ operation: "write", detail: "appended turn to JSONL transcript", source: this.transcriptPath });
  }

  async recall(query: string): Promise<MemoryHit[]> {
    const tokens = tokenize(query);
    this.debug({ operation: "recall", detail: `running transcript lexical search with ${tokens.length} token(s)`, query });
    if (tokens.length === 0 || !existsSync(this.sessionsDir)) {
      this.debug({ operation: "recall", detail: "transcript lexical search skipped; no query tokens or transcript directory", query, hits: 0 });
      return [];
    }
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

    const results = hits.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || String(b.timestamp).localeCompare(String(a.timestamp))).slice(0, 10);
    this.debug({ operation: "recall", detail: `transcript lexical search scanned ${files.length} file(s) and returned ${results.length} hit(s)`, query, hits: results.length });
    return results;
  }

  async index(): Promise<string> {
    await ensureDir(this.sessionsDir);
    this.debug({ operation: "index", detail: "transcript backend checked JSONL directory; no separate index required", source: this.sessionsDir });
    return "transcript backend uses JSONL directly; no separate index is required.";
  }
}

class QmdMemoryBackend extends TranscriptMemoryBackend {
  id = "qmd" as const;
  private readonly touchedSummaryPaths = new Set<string>();

  private get memoryDir(): string {
    return join(this.root, "memory");
  }

  private get summariesDir(): string {
    return join(this.memoryDir, "summaries");
  }

  private get factsPath(): string {
    return join(this.memoryDir, "facts.md");
  }

  private get statePath(): string {
    return join(this.memoryDir, "state.md");
  }

  private get conflictsPath(): string {
    return join(this.memoryDir, "conflicts.md");
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
        this.synthesisProvider
          ? `Markdown synthesis: model-based via ${this.synthesisProvider.label}`
          : "Markdown synthesis: unavailable; falling back to minimal unsynthesized bullets.",
        "Hardwired qmd recall currently uses lexical search over markdown plus transcript; qmd skill modes can use the @tobilu/qmd CLI for model-centric retrieval.",
      ],
    };
  }

  override async beforePrompt(input: MemoryInput): Promise<MemoryContext> {
    this.debug({ operation: "before-prompt", detail: `preparing qmd-shaped memory context with up to ${this.maxPromptHits} hit(s)`, query: input.userText });
    const hits = (await this.recall(input.userText)).slice(0, this.maxPromptHits);
    this.debug({ operation: "before-prompt", detail: `injecting ${hits.length} qmd-shaped remembered context hit(s)`, query: input.userText, hits: hits.length });
    return { text: renderContext(hits), hits };
  }

  override async afterTurn(turn: ConversationTurn): Promise<void> {
    await super.afterTurn(turn);
    await ensureDir(this.summariesDir);
    await this.ensureSeedFiles();
    const summaryPath = this.summaryPathForTimestamp(turn.timestamp);
    this.touchedSummaryPaths.add(summaryPath);
    const transcriptSource = join(".memchat", "sessions", `${this.sessionId}.jsonl`);
    const memory = await this.snapshotMemory(summaryPath);
    let synthesis: MemorySynthesis | undefined;

    if (this.synthesisProvider) {
      this.debug({ operation: "synthesize", detail: `synthesizing markdown memory with ${this.synthesisProvider.label}`, source: summaryPath });
      try {
        synthesis = await this.synthesisProvider.synthesizeTurn({ turn, sessionId: this.sessionId, transcriptSource, memory });
      } catch (error) {
        this.debug({ operation: "synthesize", detail: `synthesis failed; falling back to minimal bullet: ${error instanceof Error ? error.message : String(error)}`, source: summaryPath });
      }
    }

    synthesis ??= this.fallbackSynthesis(turn);
    await this.writeSynthesis(turn, synthesis, transcriptSource, summaryPath);
  }

  override async recall(query: string): Promise<MemoryHit[]> {
    const tokens = tokenize(query);
    this.debug({ operation: "recall", detail: `running two-stage qmd lexical recall with ${tokens.length} token(s)`, query });
    if (tokens.length === 0) {
      this.debug({ operation: "recall", detail: "two-stage qmd lexical recall skipped; no query tokens", query, hits: 0 });
      return [];
    }
    await this.ensureSeedFiles();
    const markdownHits = await this.searchMarkdown(tokens, query);
    if (!this.shouldFallbackToTranscript(markdownHits, tokens)) {
      const results = markdownHits.slice(0, 10);
      this.debug({ operation: "recall", detail: `stage 1 synthesized markdown memory was sufficient; skipped transcript fallback`, query, hits: results.length });
      return results;
    }

    const transcriptHits = await super.recall(query);
    const results = [...markdownHits, ...transcriptHits]
      .sort((a, b) => this.stageRank(a) - this.stageRank(b) || (b.score ?? 0) - (a.score ?? 0) || String(b.timestamp).localeCompare(String(a.timestamp)))
      .slice(0, 10);
    this.debug({ operation: "recall", detail: `stage 2 transcript fallback returned ${transcriptHits.length} transcript hit(s); ${results.length} total hit(s)`, query, hits: results.length });
    return results;
  }

  override async index(): Promise<string> {
    await this.ensureSeedFiles();
    const files = await walkMarkdown(this.memoryDir);
    this.debug({ operation: "index", detail: `checked ${files.length} markdown memory file(s) for qmd-compatible lexical recall`, source: this.memoryDir });
    return `indexed ${files.length} markdown memory file(s) for lexical qmd-compatible recall.`;
  }

  async dispose(): Promise<void> {
    if (!this.synthesisProvider?.compactSession) return;
    await this.ensureSeedFiles();
    const summaryPaths = this.touchedSummaryPaths.size > 0 ? [...this.touchedSummaryPaths] : [this.summaryPathForTimestamp(new Date().toISOString())];
    const sessionSummary = (await Promise.all(summaryPaths.map(async (path) => existsSync(path) ? await readFile(path, "utf-8") : ""))).join("\n\n");
    if (!sessionSummary.trim()) return;
    const sessionSummaryPath = summaryPaths[summaryPaths.length - 1];
    const transcriptSource = join(".memchat", "sessions", `${this.sessionId}.jsonl`);
    this.debug({ operation: "compact", detail: `compacting session markdown memory with ${this.synthesisProvider.label}`, source: sessionSummaryPath });
    try {
      const compaction = await this.synthesisProvider.compactSession({
        sessionId: this.sessionId,
        transcriptSource,
        memory: await this.snapshotMemory(sessionSummaryPath),
        sessionSummary,
      });
      if (!compaction) return;
      if (compaction.summaryMarkdown?.trim()) await writeFile(sessionSummaryPath, normalizeMarkdown(compaction.summaryMarkdown), "utf-8");
      if (compaction.factsMarkdown?.trim()) await writeFile(this.factsPath, normalizeMarkdown(compaction.factsMarkdown), "utf-8");
      if (compaction.stateMarkdown?.trim()) await writeFile(this.statePath, normalizeMarkdown(compaction.stateMarkdown), "utf-8");
      if (compaction.conflictsMarkdown?.trim()) await writeFile(this.conflictsPath, normalizeMarkdown(compaction.conflictsMarkdown), "utf-8");
      this.debug({ operation: "compact", detail: "wrote compacted/restated markdown memory", source: this.memoryDir });
    } catch (error) {
      this.debug({ operation: "compact", detail: `compaction failed: ${error instanceof Error ? error.message : String(error)}`, source: this.memoryDir });
    }
  }

  private async ensureSeedFiles(): Promise<void> {
    await ensureDir(this.summariesDir);
    const seedFiles: Array<[string, string]> = [
      ["facts.md", "# Facts\n\nStable extracted facts with source citations are added here.\n"],
      ["state.md", "# Current State\n\nCurrent world/chat state snapshot is restated here.\n"],
      ["conflicts.md", "# Conflicts and Retcons\n\nConflicting claims and intentional retcons are tracked here.\n"],
    ];
    for (const [name, content] of seedFiles) {
      const path = join(this.memoryDir, name);
      if (!existsSync(path)) await writeFile(path, content, "utf-8");
    }
  }

  private summaryPathForTimestamp(timestamp: string): string {
    return join(this.summariesDir, `${timestamp.slice(0, 10)}.md`);
  }

  private async snapshotMemory(summaryPath: string): Promise<MemoryFileSnapshot> {
    const readExisting = async (path: string): Promise<string> => existsSync(path) ? await readFile(path, "utf-8") : "";
    return {
      facts: await readExisting(this.factsPath),
      state: await readExisting(this.statePath),
      conflicts: await readExisting(this.conflictsPath),
      recentSummary: await readExisting(summaryPath),
    };
  }

  private fallbackSynthesis(turn: ConversationTurn): MemorySynthesis {
    return {
      summaryBullets: [`Unsynthesized turn: user said "${turn.userText.replace(/\s+/g, " ").slice(0, 180)}"; assistant replied with ${turn.assistantText.length} character(s).`],
      facts: [],
      state: [],
      conflicts: [],
    };
  }

  private async writeSynthesis(turn: ConversationTurn, synthesis: MemorySynthesis, transcriptSource: string, summaryPath: string): Promise<void> {
    const source = `${transcriptSource} @ ${turn.timestamp}`;
    if (synthesis.summaryBullets.length > 0) {
      const entry = [`\n## ${turn.timestamp}`, "", asBullets(synthesis.summaryBullets), "", `Source: ${source}`].join("\n");
      await appendFile(summaryPath, `${entry}\n`, "utf-8");
      this.debug({ operation: "write", detail: `appended ${synthesis.summaryBullets.length} synthesized summary bullet(s)`, source: summaryPath });
    }
    if (synthesis.facts.length > 0) {
      await appendFile(this.factsPath, `\n## ${turn.timestamp}\n\n${asBullets(synthesis.facts.map((fact) => `${fact} Source: ${source}`))}\n`, "utf-8");
      this.debug({ operation: "write", detail: `appended ${synthesis.facts.length} fact(s)`, source: this.factsPath });
    }
    if (synthesis.state.length > 0) {
      await appendFile(this.statePath, `\n## Update ${turn.timestamp}\n\n${asBullets(synthesis.state.map((item) => `${item} Source: ${source}`))}\n`, "utf-8");
      this.debug({ operation: "write", detail: `appended ${synthesis.state.length} state update(s)`, source: this.statePath });
    }
    if (synthesis.conflicts.length > 0) {
      await appendFile(this.conflictsPath, `\n## ${turn.timestamp}\n\n${asBullets(synthesis.conflicts.map((conflict) => `${conflict} Source: ${source}`))}\n`, "utf-8");
      this.debug({ operation: "write", detail: `appended ${synthesis.conflicts.length} conflict/retcon note(s)`, source: this.conflictsPath });
    }
  }

  private shouldFallbackToTranscript(markdownHits: MemoryHit[], queryTokens: string[]): boolean {
    if (markdownHits.length === 0) return true;
    const topScore = markdownHits[0]?.score ?? 0;
    const sufficientScore = Math.min(2, Math.max(1, queryTokens.length));
    if (topScore < sufficientScore) return true;
    return markdownHits.some((hit) => hit.kind === "conflict" || /\b(conflict|retcon|contradict|uncertain|unknown|ambiguous|verify|source)\b/i.test(hit.text));
  }

  private stageRank(hit: MemoryHit): number {
    return hit.kind === "transcript" ? 1 : 0;
  }

  private async searchMarkdown(tokens: string[], query: string): Promise<MemoryHit[]> {
    const files = await walkMarkdown(this.memoryDir);
    this.debug({ operation: "recall", detail: `running markdown lexical search across ${files.length} file(s)`, query, source: this.memoryDir });
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
    const results = hits.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || String(b.timestamp).localeCompare(String(a.timestamp))).slice(0, 10);
    this.debug({ operation: "recall", detail: `stage 1 markdown lexical search returned ${results.length} synthesized memory hit(s)`, query, hits: results.length, source: this.memoryDir });
    return results;
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
