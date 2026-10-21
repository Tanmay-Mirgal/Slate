/** The sentence to show for a failed request: server messages are already written for people, so this only picks the first line and applies a fallback. */
export function cleanError(err: unknown, fallback = "Something went wrong. Please try again."): string {
  const raw = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  const text = raw.split("\n")[0].trim();
  return text || fallback;
}
