import { parseDsl } from "@/lib/diagram/dsl";
import type { DiagramKind } from "@/lib/diagram/graph";
import { STARTER_TEMPLATES } from "@/lib/diagram/starter-templates";
import { TEMPLATES } from "@/lib/diagram/templates";

/**
 * The built-in templates a board can start from: the dashboard's one-click starters and the library the offline
 * generator draws on. They are all diagram-as-code, so a server can lay any of them out.
 */

export interface TemplateInfo {
  id: string;
  title: string;
  description: string;
  kind: DiagramKind | "interview";
  /** Diagram-as-code source; null for the interview board (it has no diagram). */
  dsl: string | null;
}

let cache: TemplateInfo[] | null = null;

export function builtInTemplates(): TemplateInfo[] {
  if (cache) return cache;
  const out: TemplateInfo[] = [];
  for (const s of STARTER_TEMPLATES) {
    const kind = s.dsl ? (parseDsl(s.dsl).graph.kind as DiagramKind) : ("interview" as const);
    out.push({ id: s.id, title: s.title, description: s.description, kind, dsl: s.dsl });
  }
  for (const t of TEMPLATES) {
    if (out.some((o) => o.id === t.id)) continue;
    out.push({ id: t.id, title: t.title, description: t.description, kind: t.kind, dsl: t.dsl });
  }
  cache = out;
  return out;
}

export const templateById = (id: string): TemplateInfo | undefined => builtInTemplates().find((t) => t.id === id);
