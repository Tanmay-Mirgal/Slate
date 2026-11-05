import { z } from "zod";
import { decodeCursor, encodeCursor } from "@/lib/connector/data";
import { EVENT_DEFINITIONS } from "@/lib/connector/events/definitions";
import { toEnvelope } from "@/lib/connector/events/emit";
import { ok, tokenRoute } from "@/lib/connector/http";
import { paginationQuery } from "@/lib/connector/registry/schema";
import { matchesEvent, patternProblems } from "@/lib/connector/webhooks/store";
import { err } from "@/lib/connector/errors";
import { getCollections } from "@/lib/db/mongo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const needs = new Map<string, readonly string[]>(EVENT_DEFINITIONS.map((e) => [e.type, e.scopes]));
/** How many log rows one request may look through to fill a page (a filter can leave most rows out). */
const MAX_SCAN = 1000;

/**
 * GET /api/connect/v1/events?cursor=&types=: the workspace's event log in order, kept 7 days. It is the polling
 * fallback: a consumer that missed webhooks asks for everything after the last cursor it processed. Only events
 * the connection may read are returned (the same filter that decides who gets a webhook).
 */
export const GET = tokenRoute({ route: "/events", scopes: ["slate:events:read"] }, async (c) => {
  const q = c.parse(z.strictObject({ ...paginationQuery, types: z.string().max(500).optional().meta({ description: "Comma separated event types or prefix patterns" }) }), Object.fromEntries(c.url.searchParams));
  const after = decodeCursor(q.cursor, z.object({ c: z.number().int().min(0) }))?.c ?? 0;
  const patterns = q.types ? q.types.split(",").map((s) => s.trim()).filter(Boolean) : null;
  if (patterns) {
    const problems = patternProblems(patterns);
    if (problems.length > 0) throw err.validation("Some event types are not recognised", problems.map((p) => ({ ...p, path: "types" })));
  }

  const db = await getCollections();
  const items: ReturnType<typeof toEnvelope>[] = [];
  let lastCursor = after;
  let from = after;
  scan: while (items.length < q.limit) {
    const rows = await db.connectorEvents
      .find({ workspaceId: c.grant.workspaceId, cursor: { $gt: from } })
      .sort({ cursor: 1 })
      .limit(Math.min(200, q.limit * 2))
      .toArray();
    if (rows.length === 0) break;
    for (const ev of rows) {
      from = ev.cursor;
      if (from - after > MAX_SCAN) break scan;
      lastCursor = ev.cursor;
      if (patterns && !matchesEvent(patterns, ev.type)) continue;
      if (!(needs.get(ev.type) ?? ["slate:boards:read"]).every((s) => c.grant.effective.has(s as never))) continue;
      items.push(toEnvelope(ev));
      if (items.length >= q.limit) break scan;
    }
  }
  return ok({ items, nextCursor: items.length > 0 ? encodeCursor({ c: lastCursor }) : null });
});
