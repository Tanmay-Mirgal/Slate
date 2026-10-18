/**
 * Convex wraps server errors like `[CONVEX M(comments:reply)] [Request ID: ab12] Server Error\nUncaught Error: You're
 * commenting too fast...\n    at handler (...)`. People should only see the sentence we wrote.
 */
export function cleanError(err: unknown, fallback = "Something went wrong. Please try again."): string {
  const raw = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  const m = /Uncaught Error:\s*([^\n]+)/.exec(raw);
  const text = (m ? m[1] : raw.split("\n")[0]).replace(/^\[CONVEX[^\]]*\]\s*(\[Request ID:[^\]]*\]\s*)?/, "").trim();
  return text && !/^Server Error$/i.test(text) ? text : fallback;
}
