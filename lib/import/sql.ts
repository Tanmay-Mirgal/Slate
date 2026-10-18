import { normalizeGraph, type GEdge, type GNode, type Graph } from "../diagram/graph";
import type { TableColumn } from "../canvas/types";
import { code, table, type ImportResult } from "./types";

/**
 * SQL DDL -> ER diagram + documentation. Reads CREATE TABLE (column and table constraints) and
 * ALTER TABLE ... ADD FOREIGN KEY, in the dialects people paste most (PostgreSQL, MySQL, SQLite,
 * SQL Server). Anything it doesn't understand is skipped rather than guessed.
 */

interface Column {
  name: string;
  type: string;
  pk: boolean;
  unique: boolean;
  notNull: boolean;
  fk?: { table: string; column?: string };
}

interface Table {
  name: string;
  columns: Column[];
}

interface Relation {
  from: string; // referencing (child) table
  column: string;
  to: string; // referenced (parent) table
  toColumn?: string;
}

const IDENT = String.raw`(?:"[^"]+"|` + "`[^`]+`" + String.raw`|\[[^\]]+\]|[A-Za-z_][\w$]*)`;
const QUALIFIED = String.raw`${IDENT}(?:\s*\.\s*${IDENT})?`;

function unquote(id: string): string {
  const t = id.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("`") && t.endsWith("`")) || (t.startsWith("[") && t.endsWith("]"))) return t.slice(1, -1);
  return t;
}

/** `public.users` -> `users`. */
function tableName(qualified: string): string {
  const parts = qualified.split(/\s*\.\s*/);
  return unquote(parts[parts.length - 1]);
}

function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\r\n]*/g, " ");
}

/** Splits on commas that are not nested inside parentheses or quotes. */
function splitTop(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let cur = "";
  for (const ch of body) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      cur += ch;
    } else if (ch === "(") {
      depth++;
      cur += ch;
    } else if (ch === ")") {
      depth--;
      cur += ch;
    } else if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

/** The text between the parenthesis that opens at `start` and its match. */
function balanced(sql: string, start: number): { body: string; end: number } | null {
  let depth = 0;
  let quote: string | null = null;
  for (let i = start; i < sql.length; i++) {
    const ch = sql[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return { body: sql.slice(start + 1, i), end: i };
    }
  }
  return null;
}

const CONSTRAINT_WORDS = /\b(NOT\s+NULL|NULL|PRIMARY\s+KEY|DEFAULT|REFERENCES|UNIQUE|CHECK|GENERATED|AUTO_INCREMENT|AUTOINCREMENT|IDENTITY|COLLATE|CONSTRAINT|COMMENT|ON\s+UPDATE)\b/i;

function columnList(s: string): string[] {
  return s.split(",").map((c) => unquote(c.trim().split(/\s+/)[0])).filter(Boolean);
}

function parseColumn(def: string): Column | null {
  const m = new RegExp(String.raw`^(${IDENT})\s+([\s\S]*)$`).exec(def.trim());
  if (!m) return null;
  const rest = m[2];
  const cut = rest.search(CONSTRAINT_WORDS);
  const type = (cut < 0 ? rest : rest.slice(0, cut)).replace(/\s+/g, " ").trim();
  if (!type) return null;
  const col: Column = {
    name: unquote(m[1]),
    type: type.slice(0, 40),
    pk: /PRIMARY\s+KEY/i.test(rest),
    unique: /\bUNIQUE\b/i.test(rest),
    notNull: /NOT\s+NULL/i.test(rest) || /PRIMARY\s+KEY/i.test(rest),
  };
  const ref = new RegExp(String.raw`REFERENCES\s+(${QUALIFIED})\s*(?:\(\s*(${IDENT})\s*\))?`, "i").exec(rest);
  if (ref) col.fk = { table: tableName(ref[1]), column: ref[2] ? unquote(ref[2]) : undefined };
  return col;
}

export function looksLikeSql(text: string): boolean {
  return /\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:TEMP(?:ORARY)?\s+|UNLOGGED\s+)?TABLE\b/i.test(text);
}

function parseSchema(sql: string): { tables: Table[]; relations: Relation[] } {
  const clean = stripComments(sql);
  const tables: Table[] = [];
  const relations: Relation[] = [];
  const createRe = new RegExp(String.raw`CREATE\s+(?:OR\s+REPLACE\s+)?(?:TEMP(?:ORARY)?\s+|UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(${QUALIFIED})\s*\(`, "gi");
  let m: RegExpExecArray | null;
  while ((m = createRe.exec(clean))) {
    const open = m.index + m[0].length - 1;
    const block = balanced(clean, open);
    if (!block) continue;
    createRe.lastIndex = block.end;
    const t: Table = { name: tableName(m[1]), columns: [] };
    const pkCols = new Set<string>();
    const uniqueCols = new Set<string>();
    const tableFks: { cols: string[]; ref: string; refCols: string[] }[] = [];
    for (const def of splitTop(block.body)) {
      const upper = def.toUpperCase();
      const tc = /^(?:CONSTRAINT\s+\S+\s+)?(PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE(?:\s+(?:KEY|INDEX))?|CHECK|KEY|INDEX|FULLTEXT|EXCLUDE)\b/i.exec(def);
      if (tc) {
        const kind = tc[1].toUpperCase().replace(/\s+/g, " ");
        const cols = /\(([^)]*)\)/.exec(def);
        if (kind === "PRIMARY KEY" && cols) columnList(cols[1]).forEach((c) => pkCols.add(c));
        else if (kind.startsWith("UNIQUE") && cols) columnList(cols[1]).forEach((c) => uniqueCols.add(c));
        else if (kind === "FOREIGN KEY") {
          const fk = new RegExp(String.raw`FOREIGN\s+KEY\s*\(([^)]*)\)\s*REFERENCES\s+(${QUALIFIED})\s*(?:\(([^)]*)\))?`, "i").exec(def);
          if (fk) tableFks.push({ cols: columnList(fk[1]), ref: tableName(fk[2]), refCols: fk[3] ? columnList(fk[3]) : [] });
        }
        continue;
      }
      if (/^(LIKE|PERIOD|PARTITION)\b/.test(upper)) continue;
      const col = parseColumn(def);
      if (col) t.columns.push(col);
    }
    for (const c of t.columns) {
      if (pkCols.has(c.name)) {
        c.pk = true;
        c.notNull = true;
      }
      if (uniqueCols.has(c.name)) c.unique = true;
    }
    for (const fk of tableFks) {
      fk.cols.forEach((name, i) => {
        const c = t.columns.find((x) => x.name === name);
        if (c) c.fk = { table: fk.ref, column: fk.refCols[i] };
      });
    }
    tables.push(t);
  }

  // ALTER TABLE child ADD [CONSTRAINT n] FOREIGN KEY (a) REFERENCES parent(b)
  const alterRe = new RegExp(String.raw`ALTER\s+TABLE\s+(?:ONLY\s+)?(?:IF\s+EXISTS\s+)?(${QUALIFIED})\s+ADD\s+(?:CONSTRAINT\s+${IDENT}\s+)?FOREIGN\s+KEY\s*\(([^)]*)\)\s*REFERENCES\s+(${QUALIFIED})\s*(?:\(([^)]*)\))?`, "gi");
  while ((m = alterRe.exec(clean))) {
    const t = tables.find((x) => x.name === tableName(m![1]));
    const cols = columnList(m[2]);
    const refCols = m[4] ? columnList(m[4]) : [];
    cols.forEach((name, i) => {
      const c = t?.columns.find((x) => x.name === name);
      if (c) c.fk = { table: tableName(m![3]), column: refCols[i] };
    });
  }

  for (const t of tables) {
    for (const c of t.columns) if (c.fk) relations.push({ from: t.name, column: c.name, to: c.fk.table, toColumn: c.fk.column });
  }
  return { tables, relations };
}

export function sqlToImport(text: string): ImportResult | null {
  if (!looksLikeSql(text)) return null;
  const { tables, relations } = parseSchema(text);
  if (tables.length === 0) return null;
  const warnings: string[] = [];
  const known = new Set(tables.map((t) => t.name.toLowerCase()));

  const nodes: GNode[] = tables.map((t) => {
    const fields: TableColumn[] = t.columns.map((c) => ({ name: c.name, type: c.type.slice(0, 24), key: c.pk ? "pk" : c.fk ? "fk" : c.unique ? "unique" : undefined }));
    return { id: t.name, label: t.name, fields };
  });
  const edges: GEdge[] = [];
  const seen = new Set<string>();
  for (const r of relations) {
    if (!known.has(r.to.toLowerCase())) {
      warnings.push(`${r.from}.${r.column} references ${r.to}, which isn't in the schema, so that link was skipped.`);
      continue;
    }
    const child = tables.find((t) => t.name === r.from)!;
    const col = child.columns.find((c) => c.name === r.column);
    const one = !!col && (col.unique || (col.pk && child.columns.filter((c) => c.pk).length === 1));
    const key = `${r.to}>${r.from}>${r.column}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ from: tables.find((t) => t.name.toLowerCase() === r.to.toLowerCase())!.name, to: r.from, label: one ? "1 : 1" : "1 : N" });
  }
  const title = "Database schema";
  const { graph, warnings: more } = normalizeGraph({ kind: "erd", title, direction: "right", nodes, groups: [], edges } as Graph, "erd");
  const truncated = tables.some((t) => t.columns.length > 14);
  if (truncated) warnings.push("Tables with more than 14 columns show the first 14 on the canvas; the document lists them all.");
  return { source: "sql", title, graph, markdown: sqlMarkdown(title, tables, relations, known), warnings: [...warnings, ...more] };
}

function sqlMarkdown(title: string, tables: Table[], relations: Relation[], known: Set<string>): string {
  const out: string[] = [`# ${title}`, "", `> Generated by Slate from SQL DDL: ${tables.length} table${tables.length === 1 ? "" : "s"}, ${relations.filter((r) => known.has(r.to.toLowerCase())).length} relationship${relations.length === 1 ? "" : "s"}.`, ""];
  out.push("## Tables", "", table(["Table", "Columns", "Primary key", "References"], tables.map((t) => [code(t.name), t.columns.length, t.columns.filter((c) => c.pk).map((c) => code(c.name)).join(", "), Array.from(new Set(t.columns.filter((c) => c.fk).map((c) => c.fk!.table))).map(code).join(", ")])), "");
  for (const t of tables) {
    out.push(`### ${t.name}`, "");
    out.push(
      table(
        ["Column", "Type", "Constraints"],
        t.columns.map((c) => [
          code(c.name),
          code(c.type),
          [c.pk ? "primary key" : "", c.fk ? `foreign key → ${c.fk.table}${c.fk.column ? `.${c.fk.column}` : ""}` : "", c.unique && !c.pk ? "unique" : "", c.notNull && !c.pk ? "not null" : ""].filter(Boolean).join(", "),
        ])
      ),
      ""
    );
  }
  const rels = relations.filter((r) => known.has(r.to.toLowerCase()));
  if (rels.length) {
    out.push("## Relationships", "");
    for (const r of rels) out.push(`- ${code(r.to)} has many ${code(r.from)} through ${code(`${r.from}.${r.column}`)}${r.toColumn ? ` → ${code(`${r.to}.${r.toColumn}`)}` : ""}`);
    out.push("");
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
