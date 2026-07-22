import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRegistry,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { resolve } from "node:path";
import { canonicalHash } from "./identity-service.js";
import {
  buildAssignmentBoundProbeLaunch,
  type HostProbeEvidence,
} from "./acceptance-service.js";
import type { PreparedAcceptanceProbe } from "./acceptance-materializer.js";

export type AssignmentBoundAcceptanceHost = {
  adapter: string;
  runtime: string;
  launch(prepared: PreparedAcceptanceProbe, options: { model: string; thinking: string }): Promise<HostProbeEvidence>;
};

function parseModelId(value: string): { provider: string; id: string } {
  const separator = value.indexOf("/");
  if (separator <= 0 || separator === value.length - 1) throw new Error("Acceptance model must use provider/model-id form");
  return { provider: value.slice(0, separator), id: value.slice(separator + 1) };
}

type PiThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

function parseThinking(value: string): PiThinkingLevel {
  if (!["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(value)) throw new Error(`Unsupported acceptance thinking level ${value}`);
  return value as PiThinkingLevel;
}

/** Concrete assignment-bound child adapter built on Pi's SDK. It uses an
 * in-memory child session, activates only assignment.tools, and derives host
 * identity, observed tools, and tool-call telemetry from the child runtime. */
export class PiSdkAcceptanceHostAdapter implements AssignmentBoundAcceptanceHost {
  readonly adapter = "pi-sdk-assignment-bound";
  readonly runtime = `pi-sdk/node-${process.versions.node}`;

  constructor(private readonly cwd = process.cwd(), private readonly extensionPath = resolve(cwd, "extensions/mem-import-tools.ts")) {}

  async launch(prepared: PreparedAcceptanceProbe, options: { model: string; thinking: string }): Promise<HostProbeEvidence> {
    const request = buildAssignmentBoundProbeLaunch(prepared, options.model, options.thinking);
    const authStorage = AuthStorage.create();
    const modelRegistry = ModelRegistry.create(authStorage);
    const parsedModel = parseModelId(request.model);
    const model = modelRegistry.find(parsedModel.provider, parsedModel.id);
    if (!model) throw new Error(`Acceptance model is not registered: ${request.model}`);
    const available = await modelRegistry.getAvailable();
    if (!available.some((item) => item.provider === model.provider && item.id === model.id)) throw new Error(`Acceptance model has no configured authentication: ${request.model}`);
    const loader = new DefaultResourceLoader({ cwd: this.cwd, agentDir: getAgentDir(), additionalExtensionPaths: [this.extensionPath] });
    await loader.reload();
    const { session } = await createAgentSession({
      cwd: this.cwd,
      model,
      thinkingLevel: parseThinking(request.thinking),
      tools: request.tools,
      resourceLoader: loader,
      authStorage,
      modelRegistry,
      sessionManager: SessionManager.inMemory(this.cwd),
    });
    const observedTools = session.agent.state.tools.map((tool) => tool.name);
    const observedModel = session.model ? `${session.model.provider}/${session.model.id}` : "unknown";
    const observedThinking = session.thinkingLevel;
    const toolCalls: string[] = [];
    const toolCallArgumentHashes: string[] = [];
    let toolFailed = false;
    let diagnostic: string | undefined;
    const unsubscribe = session.subscribe((event) => {
      if (event.type === "tool_execution_start") {
        toolCalls.push(event.toolName);
        toolCallArgumentHashes.push(canonicalHash(event.args));
      }
      if (event.type === "tool_execution_end" && event.isError) {
        toolFailed = true;
        diagnostic = JSON.stringify(event.result.details ?? event.result.content).slice(0, 500);
      }
    });
    let outcome: HostProbeEvidence["outcome"] = "completed";
    try {
      await session.prompt(request.task);
      if (toolFailed || session.agent.state.errorMessage) outcome = "failed";
    } catch {
      outcome = "failed";
    } finally {
      unsubscribe();
      session.dispose();
    }
    return {
      facility: "ordinary-subagent",
      hostTaskId: session.sessionId,
      requestedTools: [...request.tools],
      observedTools,
      toolCalls,
      outcome,
      observedModel,
      observedThinking,
      toolCallArgumentHashes,
      ...(diagnostic ? { diagnostic } : {}),
    };
  }
}
