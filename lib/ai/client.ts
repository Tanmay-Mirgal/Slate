import type { DiagramKind, Graph } from "../diagram/graph";
import type { Complexity } from "./prompt";

export interface DiagramRequest {
  prompt: string;
  kind: DiagramKind | "auto";
  complexity: Complexity;
  currentDsl?: string;
}

export interface DiagramResponse {
  graph: Graph;
  dsl: string;
  warnings: string[];
  model: string;
  attempts: number;
}

export class ClientAiError extends Error {
  constructor(
    public code: string,
    message: string,
    public retryAfterSeconds?: number
  ) {
    super(message);
  }
}

export interface RequestHandlers {
  signal?: AbortSignal;
  onStatus?: (s: { phase: "thinking" | "retry" | "fallback"; model: string; attempt: number }) => void;
  onProgress?: (chars: number) => void;
}

/** Calls /api/ai/generate and reads its newline-delimited JSON event stream. */
export async function requestDiagram(req: DiagramRequest, h: RequestHandlers = {}): Promise<DiagramResponse> {
  let res: Response;
  try {
    res = await fetch("/api/ai/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
      signal: h.signal,
    });
  } catch (e) {
    if (h.signal?.aborted) throw new ClientAiError("aborted", "Cancelled");
    throw new ClientAiError("network", "Couldn't reach the server. Check your connection and try again.");
  }

  const ct = res.headers.get("content-type") ?? "";
  if (!res.ok || !ct.includes("ndjson")) {
    let code = "upstream";
    let message = `The request failed (${res.status}).`;
    let retry: number | undefined;
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string; retryAfterSeconds?: number } };
      if (body.error) {
        code = body.error.code ?? code;
        message = body.error.message ?? message;
        retry = body.error.retryAfterSeconds;
      }
    } catch {
      /* non-JSON error page */
    }
    throw new ClientAiError(code, message, retry);
  }
  if (!res.body) throw new ClientAiError("upstream", "The server sent an empty response.");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: DiagramResponse | null = null;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        let evt: Record<string, unknown>;
        try {
          evt = JSON.parse(line);
        } catch {
          continue;
        }
        if (evt.type === "status") h.onStatus?.(evt as never);
        else if (evt.type === "progress") h.onProgress?.(Number(evt.chars) || 0);
        else if (evt.type === "result") result = evt as unknown as DiagramResponse;
        else if (evt.type === "error") throw new ClientAiError(String(evt.code ?? "upstream"), String(evt.message ?? "Generation failed"), typeof evt.retryAfterSeconds === "number" ? evt.retryAfterSeconds : undefined);
      }
    }
  } catch (e) {
    if (e instanceof ClientAiError) throw e;
    if (h.signal?.aborted) throw new ClientAiError("aborted", "Cancelled");
    throw new ClientAiError("network", "The connection dropped while generating. Please try again.");
  }
  if (!result) throw new ClientAiError("upstream", "The server finished without returning a diagram.");
  return result;
}
