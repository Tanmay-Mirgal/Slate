/**
 * NVIDIA NIM (build.nvidia.com) client. The API is OpenAI-compatible:
 *   POST {base}/chat/completions   Authorization: Bearer nvapi-...
 * Free-tier keys work for development / light production use and are rate limited by NVIDIA, so the
 * route tries a chain of models and surfaces upstream limits to the user instead of failing silently.
 */

export type AiErrorCode = "not_configured" | "bad_key" | "rate_limited" | "upstream" | "timeout" | "invalid_output" | "aborted";

export class AiError extends Error {
  constructor(
    public code: AiErrorCode,
    message: string,
    public status?: number,
    public retryAfterMs?: number
  ) {
    super(message);
  }
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Best-first chain of free hosted models that follow structured-output instructions well.
 * Override with NVIDIA_MODELS="a,b,c" (comma separated, first = preferred).
 */
export const DEFAULT_MODELS = [
  "nvidia/nemotron-3-ultra-550b-a55b",
  "nvidia/nemotron-3.5-super-vl-120b-a12b",
  "nvidia/nemotron-3-super-120b-a12b",
];

export interface NvidiaConfig {
  apiKey: string | null;
  baseUrl: string;
  models: string[];
}

export function nvidiaConfig(env: Record<string, string | undefined> = process.env): NvidiaConfig {
  const key = env.NVIDIA_API_KEY?.trim();
  const models = (env.NVIDIA_MODELS ?? "")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  return {
    apiKey: key && !/your_|placeholder|nvapi-xxx/i.test(key) ? key : null,
    baseUrl: (env.NVIDIA_BASE_URL?.trim() || "https://integrate.api.nvidia.com/v1").replace(/\/+$/, ""),
    models: models.length ? models : DEFAULT_MODELS,
  };
}

export interface StreamOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  messages: ChatMessage[];
  maxTokens: number;
  temperature?: number;
  signal?: AbortSignal;
  /** Called with the running character count (content + reasoning) as tokens arrive. */
  onProgress?: (chars: number) => void;
  /** Abort if nothing at all arrives for this long. */
  idleMs?: number;
  /** Hard ceiling for the whole completion. */
  totalMs?: number;
}

export interface StreamResult {
  text: string;
  finishReason: string | null;
}

export async function streamChat(o: StreamOptions): Promise<StreamResult> {
  const controller = new AbortController();
  const idleMs = o.idleMs ?? 30_000;
  const totalMs = o.totalMs ?? 90_000;
  let idle: ReturnType<typeof setTimeout> | null = null;
  let timedOut = false;
  const armIdle = () => {
    if (idle) clearTimeout(idle);
    idle = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, idleMs);
  };
  const total = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, totalMs);
  const onAbort = () => controller.abort();
  o.signal?.addEventListener("abort", onAbort);
  armIdle();

  try {
    const res = await fetch(`${o.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream", Authorization: `Bearer ${o.apiKey}` },
      body: JSON.stringify({
        model: o.model,
        messages: o.messages,
        temperature: o.temperature ?? 0.25,
        top_p: 0.9,
        max_tokens: o.maxTokens,
        stream: true,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = (await res.text().catch(() => "")).slice(0, 400);
      if (res.status === 401 || res.status === 403) throw new AiError("bad_key", "The NVIDIA API key was rejected. Check NVIDIA_API_KEY.", res.status);
      if (res.status === 429) {
        const retry = Number(res.headers.get("retry-after"));
        throw new AiError("rate_limited", "NVIDIA's free tier is rate limiting requests right now.", 429, Number.isFinite(retry) && retry > 0 ? retry * 1000 : 15_000);
      }
      throw new AiError("upstream", `Model ${o.model} returned ${res.status}${body ? `: ${body}` : ""}`, res.status);
    }
    if (!res.body) throw new AiError("upstream", "The model returned an empty response");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";
    let reasoning = 0;
    let finish: string | null = null;
    let lastReport = 0;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      armIdle();
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const evt = JSON.parse(payload) as { choices?: { delta?: { content?: string; reasoning_content?: string; reasoning?: string }; finish_reason?: string | null }[] };
          const choice = evt.choices?.[0];
          const d = choice?.delta;
          if (d?.content) text += d.content;
          const r = d?.reasoning_content ?? d?.reasoning;
          if (r) reasoning += r.length;
          if (choice?.finish_reason) finish = choice.finish_reason;
        } catch {
          /* keep-alive comment or partial JSON: ignore */
        }
      }
      const now = Date.now();
      if (o.onProgress && now - lastReport > 200) {
        lastReport = now;
        o.onProgress(text.length + reasoning);
      }
    }
    o.onProgress?.(text.length + reasoning);
    return { text, finishReason: finish };
  } catch (err) {
    if (err instanceof AiError) throw err;
    if (o.signal?.aborted) throw new AiError("aborted", "Generation was cancelled");
    if (timedOut || (err instanceof Error && err.name === "AbortError")) throw new AiError("timeout", `Model ${o.model} took too long to respond`);
    throw new AiError("upstream", err instanceof Error ? err.message : "Could not reach NVIDIA");
  } finally {
    if (idle) clearTimeout(idle);
    clearTimeout(total);
    o.signal?.removeEventListener("abort", onAbort);
  }
}
