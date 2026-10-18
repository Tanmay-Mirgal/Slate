import { graphToDsl } from "../diagram/dsl";
import { normalizeGraph, type DiagramKind, type Graph } from "../diagram/graph";
import { extractJson } from "./json";
import { AiError, streamChat, type ChatMessage, type NvidiaConfig } from "./nvidia";
import { buildMessages, COMPLEXITY, repairMessages, type PromptInput } from "./prompt";

export interface GenerateEvents {
  onStatus?: (s: { phase: "thinking" | "retry" | "fallback"; model: string; attempt: number }) => void;
  onProgress?: (chars: number) => void;
}

export interface GenerateResult {
  graph: Graph;
  dsl: string;
  warnings: string[];
  model: string;
  attempts: number;
}

/** Throws AiError("invalid_output") when the graph is too thin to be a diagram. */
export function validateGraph(g: Graph) {
  if (g.kind === "sequence") {
    if (g.nodes.length < 2) throw new AiError("invalid_output", "A sequence diagram needs at least two participants.");
    if (!g.messages || g.messages.length < 1) throw new AiError("invalid_output", "The sequence diagram has no messages.");
    return;
  }
  if (g.nodes.length < 2) throw new AiError("invalid_output", "The diagram has fewer than two components.");
  if (g.edges.length < 1) throw new AiError("invalid_output", "The diagram has no connections between components.");
}

/** Attaches components that ended up with no connection to a sensible neighbour instead of leaving islands. */
export function connectOrphans(g: Graph, warnings: string[]): void {
  if (g.kind === "sequence" || g.kind === "mindmap" || g.nodes.length < 3) return;
  const linked = new Set<string>();
  for (const e of g.edges) {
    linked.add(e.from);
    linked.add(e.to);
  }
  const orphans = g.nodes.filter((n) => !linked.has(n.id));
  if (orphans.length === 0 || orphans.length > g.nodes.length / 2) return;
  for (const o of orphans) {
    const peer = g.nodes.find((n) => n.id !== o.id && n.group === o.group && linked.has(n.id)) ?? g.nodes.find((n) => n.id !== o.id && linked.has(n.id));
    if (peer) {
      g.edges.push({ from: peer.id, to: o.id, style: "dashed" });
      warnings.push(`"${o.label}" was not connected; linked it to "${peer.label}".`);
    }
  }
}

async function attempt(
  cfg: NvidiaConfig & { apiKey: string },
  model: string,
  messages: ChatMessage[],
  maxTokens: number,
  fallbackKind: DiagramKind,
  ev: GenerateEvents,
  signal?: AbortSignal
): Promise<{ graph: Graph; warnings: string[]; reply: string }> {
  const { text, finishReason } = await streamChat({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, model, messages, maxTokens, signal, onProgress: ev.onProgress });
  if (!text.trim()) throw new AiError("invalid_output", "The model returned an empty reply.");
  let value: unknown;
  try {
    value = extractJson(text).value;
  } catch (e) {
    throw Object.assign(new AiError("invalid_output", e instanceof Error ? e.message : "Invalid JSON"), { reply: text });
  }
  const { graph, warnings } = normalizeGraph(value, fallbackKind);
  if (finishReason === "length") warnings.push("The model hit its length limit, so the diagram may be incomplete.");
  try {
    validateGraph(graph);
  } catch (e) {
    throw Object.assign(e as AiError, { reply: text });
  }
  connectOrphans(graph, warnings);
  return { graph, warnings, reply: text };
}

/**
 * Runs the model chain: for each model try once, then once more with the failure fed back; on
 * timeouts / 5xx / rate limits move on to the next model. Bad keys abort immediately.
 */
export async function generateGraph(input: PromptInput, cfg: NvidiaConfig, ev: GenerateEvents = {}, signal?: AbortSignal): Promise<GenerateResult> {
  if (!cfg.apiKey) throw new AiError("not_configured", "AI generation isn't configured. Add NVIDIA_API_KEY to your environment.");
  const key = cfg.apiKey;
  const base = buildMessages(input);
  const fallbackKind: DiagramKind = input.kind === "auto" ? "architecture" : input.kind;
  const maxTokens = COMPLEXITY[input.complexity].maxTokens;
  let attempts = 0;
  let lastError: AiError | null = null;
  const models = cfg.models.slice(0, 3);

  for (let m = 0; m < models.length; m++) {
    const model = models[m];
    let messages = base;
    for (let tryNo = 0; tryNo < 2; tryNo++) {
      if (signal?.aborted) throw new AiError("aborted", "Generation was cancelled");
      attempts++;
      ev.onStatus?.({ phase: tryNo === 0 ? (m === 0 ? "thinking" : "fallback") : "retry", model, attempt: attempts });
      try {
        const { graph, warnings } = await attempt({ ...cfg, apiKey: key }, model, messages, maxTokens, fallbackKind, ev, signal);
        return { graph, dsl: graphToDsl(graph), warnings, model, attempts };
      } catch (e) {
        const err = e instanceof AiError ? e : new AiError("upstream", e instanceof Error ? e.message : "Unknown error");
        lastError = err;
        if (err.code === "bad_key" || err.code === "aborted" || err.code === "not_configured") throw err;
        if (err.code === "invalid_output" && tryNo === 0) {
          const reply = (e as { reply?: string }).reply ?? "";
          messages = reply ? repairMessages(base, reply, err.message) : base;
          continue; // one repair pass on the same model
        }
        break; // next model
      }
    }
  }
  throw lastError ?? new AiError("upstream", "No model produced a usable diagram.");
}
