import { normalizeReview, reviewSystemPrompt, reviewUserPrompt, type Review, type ReviewInput } from "../interview/review";
import { extractJson } from "./json";
import { AiError, streamChat, type ChatMessage, type NvidiaConfig } from "./nvidia";

/**
 * Grades a system design answer with the model chain. Same failure policy as diagram generation: a
 * reply that isn't usable JSON gets one repair pass on the same model, upstream trouble moves on to the
 * next model, and a bad key or a cancellation stops immediately.
 */
export async function generateReview(input: ReviewInput, cfg: NvidiaConfig, signal?: AbortSignal): Promise<{ review: Review; model: string }> {
  if (!cfg.apiKey) throw new AiError("not_configured", "AI review isn't configured. Add NVIDIA_API_KEY to your environment.");
  const apiKey = cfg.apiKey;
  const base: ChatMessage[] = [
    { role: "system", content: reviewSystemPrompt() },
    { role: "user", content: reviewUserPrompt(input) },
  ];
  let lastError: AiError | null = null;

  for (const model of cfg.models.slice(0, 3)) {
    let messages: ChatMessage[] = base;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (signal?.aborted) throw new AiError("aborted", "Review was cancelled");
      try {
        const { text } = await streamChat({ apiKey, baseUrl: cfg.baseUrl, model, messages, maxTokens: 2800, temperature: 0.2, signal });
        const review = normalizeReview(extractJson(text).value, model);
        if (!review) throw Object.assign(new AiError("invalid_output", "The review didn't follow the rubric."), { reply: text });
        return { review, model };
      } catch (e) {
        const err = e instanceof AiError ? e : new AiError("invalid_output", e instanceof Error ? e.message : "Could not read the review");
        lastError = err;
        if (err.code === "bad_key" || err.code === "aborted" || err.code === "not_configured") throw err;
        const reply = (e as { reply?: string }).reply;
        if (err.code === "invalid_output" && attempt === 0) {
          messages = [...base, { role: "assistant", content: (reply ?? "").slice(0, 6000) }, { role: "user", content: `That reply could not be used: ${err.message}\nReply again with ONLY the corrected JSON object.` }];
          continue;
        }
        break;
      }
    }
  }
  throw lastError ?? new AiError("upstream", "No model produced a review.");
}
