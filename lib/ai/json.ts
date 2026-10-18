/**
 * Pulls a JSON object out of an LLM reply. Models wrap JSON in prose or code fences, emit
 * <think> blocks, leave trailing commas, or get cut off by max_tokens. This handles all of that.
 */

export function stripReasoning(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<\|?thinking\|?>[\s\S]*?<\|?\/thinking\|?>/gi, "")
    .replace(/^[\s\S]*?<\/think>/i, "") // an unclosed opening tag was dropped by the provider
    .trim();
}

/** Returns the first balanced `{...}` slice (or the open tail if the reply was truncated). */
export function sliceFirstObject(text: string): { json: string; truncated: boolean } | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return { json: text.slice(start, i + 1), truncated: false };
    }
  }
  return { json: text.slice(start), truncated: true };
}

/** Closes open strings / brackets so a truncated object can still be parsed. */
export function repairTruncated(json: string): string {
  const stack: string[] = [];
  let inStr = false;
  let esc = false;
  let out = "";
  for (let i = 0; i < json.length; i++) {
    const c = json[i];
    out += c;
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") stack.push("}");
    else if (c === "[") stack.push("]");
    else if (c === "}" || c === "]") stack.pop();
  }
  if (inStr) out += '"';
  // drop a dangling key / separator before closing
  out = out.replace(/,\s*$/, "").replace(/,\s*"[^"]*"\s*:?\s*$/, "").replace(/"[^"]*"\s*:\s*$/, "");
  // cut back to the last complete element of an array that was interrupted mid-object
  while (stack.length) out += stack.pop();
  return out.replace(/,\s*([}\]])/g, "$1");
}

export class JsonExtractError extends Error {}

export function extractJson(reply: string): { value: unknown; repaired: boolean } {
  const text = stripReasoning(reply).replace(/```(?:json)?/gi, "").trim();
  const slice = sliceFirstObject(text);
  if (!slice) throw new JsonExtractError("The reply contained no JSON object");
  const attempts: [string, boolean][] = [[slice.json, false]];
  attempts.push([slice.json.replace(/,\s*([}\]])/g, "$1"), true]);
  attempts.push([repairTruncated(slice.json), true]);
  // smart quotes sometimes sneak in around keys
  attempts.push([repairTruncated(slice.json.replace(/[“”]/g, '"')), true]);
  let lastError = "invalid JSON";
  for (const [candidate, repaired] of attempts) {
    try {
      return { value: JSON.parse(candidate), repaired };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }
  throw new JsonExtractError(`Could not parse the reply as JSON (${lastError})`);
}
