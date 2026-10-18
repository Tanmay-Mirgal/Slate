import type { Graph } from "../diagram/graph";

/** What turning pasted source into a board produces: the diagram and the documentation that goes next to it. */
export interface ImportResult {
  /** How it was understood. "ai" means no deterministic parser matched and a model drew it. */
  source: "compose" | "sql" | "tree" | "ai";
  title: string;
  graph: Graph;
  /** Markdown for the document pane (headings, tables, code fences). */
  markdown: string;
  warnings: string[];
}

export type DetectedKind = "compose" | "sql" | "tree" | "unknown";

/** Escapes text for a Markdown table cell. */
export function cell(value: string | number | undefined | null): string {
  const s = value === undefined || value === null || value === "" ? "—" : String(value);
  return s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

/** Inline code that survives backticks in the content. */
export function code(value: string): string {
  return value.includes("`") ? `\`\` ${value} \`\`` : `\`${value}\``;
}

/** A GitHub-flavoured table. Returns "" for no rows so callers can skip empty sections. */
export function table(headers: string[], rows: (string | number | undefined | null)[][]): string {
  if (rows.length === 0) return "";
  const head = `| ${headers.map(cell).join(" | ")} |`;
  const sep = `| ${headers.map(() => "---").join(" | ")} |`;
  return [head, sep, ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`)].join("\n");
}

export const MAX_SOURCE_CHARS = 60_000;
