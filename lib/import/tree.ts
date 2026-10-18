import { normalizeGraph, type GEdge, type GNode, type Graph } from "../diagram/graph";
import { code, table, type ImportResult } from "./types";

/**
 * A pasted directory listing (the output of `tree`, or an indented outline) -> a mind map of the
 * project's structure plus a short guide to what each top-level folder is for. Directories become
 * nodes (to three levels deep); files are summarised on their folder, and the files that say what a
 * project *is* (package.json, Dockerfile, ...) are listed in the document.
 */

interface Entry {
  name: string;
  depth: number;
  isDir: boolean;
  children: Entry[];
  path: string;
}

const GLYPH = /^((?:[│|]\s{2,3}|\s{4})*)(?:[├└][─-]{1,2}|[+\\`|][-─]{1,2})\s*(.+)$/;

/** Heuristic: enough lines carry tree glyphs, or the text is a clean indented list of path-like names. */
export function looksLikeTree(text: string): boolean {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 3) return false;
  const glyphs = lines.filter((l) => /[├└]──|^[|+\\`][-─]{2}/.test(l) || /^\s*[│|]\s/.test(l)).length;
  if (glyphs >= Math.max(2, lines.length * 0.4)) return true;
  // Plain indentation: most lines look like file or folder names, none look like code or prose.
  const nameLike = lines.filter((l) => /^\s*[\w.@()[\]-][\w.@()[\] /-]*\/?$/.test(l) && !/\s{2,}\S+\s/.test(l.trim())).length;
  const indented = lines.filter((l) => /^\s+\S/.test(l)).length;
  return nameLike >= lines.length * 0.9 && indented >= lines.length * 0.4 && lines.some((l) => /\/\s*$/.test(l) || /\.\w{1,6}\s*$/.test(l));
}

function parseEntries(text: string): Entry[] {
  const rows: { name: string; depth: number }[] = [];
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !/^\s*\d+\s+(directories|files)/i.test(l));
  // plain indentation unit = the smallest positive indent
  const indents = lines.map((l) => /^(\s*)/.exec(l)![1].replace(/\t/g, "  ").length).filter((n) => n > 0);
  const unit = indents.length ? Math.min(...indents) : 2;
  for (const raw of lines) {
    const g = GLYPH.exec(raw.replace(/\t/g, "    "));
    if (g) {
      const prefix = g[1].replace(/\s+/g, " ");
      rows.push({ name: g[2].replace(/\s+->.*$/, "").replace(/\s+#.*$/, "").trim(), depth: Math.max(1, Math.round(prefix.length / 4) + 1) });
    } else {
      const lead = /^(\s*)/.exec(raw.replace(/\t/g, "  "))![1].length;
      rows.push({ name: raw.trim().replace(/\s+#.*$/, ""), depth: Math.round(lead / unit) });
    }
  }
  const root: Entry = { name: "", depth: -1, isDir: true, children: [], path: "" };
  const stack: Entry[] = [root];
  for (const r of rows) {
    const clean = r.name.replace(/\/+$/, "");
    if (!clean) continue;
    while (stack.length > 1 && stack[stack.length - 1].depth >= r.depth) stack.pop();
    const parent = stack[stack.length - 1];
    const entry: Entry = { name: clean, depth: r.depth, isDir: /\/\s*$/.test(r.name), children: [], path: parent.path ? `${parent.path}/${clean}` : clean };
    parent.children.push(entry);
    stack.push(entry);
  }
  // mark folders: anything with children is a directory
  const mark = (e: Entry) => {
    if (e.children.length) e.isDir = true;
    e.children.forEach(mark);
  };
  mark(root);
  return root.children;
}

const PURPOSE: [RegExp, string][] = [
  [/^(src|source|sources)$/i, "Application source code"],
  [/^app$/i, "Application entry points and routes (for example the Next.js App Router)"],
  [/^(pages)$/i, "Route components"],
  [/^(components?|ui)$/i, "Reusable UI components"],
  [/^(lib|libs|utils?|helpers?|shared|common|core|pkg|internal)$/i, "Shared libraries and helpers"],
  [/^(api|routes?|controllers?|handlers?)$/i, "HTTP API layer"],
  [/^(services?)$/i, "Business logic"],
  [/^(models?|entities|schema|schemas|db|database|prisma|migrations?|convex|drizzle)$/i, "Data model and persistence"],
  [/^(tests?|__tests__|spec|e2e|cypress|playwright)$/i, "Automated tests"],
  [/^(docs?|documentation)$/i, "Documentation"],
  [/^(public|static|assets|images?|media)$/i, "Static assets served as-is"],
  [/^(scripts?|tools?|bin|cmd)$/i, "Developer and build scripts"],
  [/^(config|configs|conf|settings)$/i, "Configuration"],
  [/^(infra|infrastructure|deploy|deployment|terraform|k8s|kubernetes|helm|charts|ansible)$/i, "Infrastructure and deployment"],
  [/^(\.github|\.gitlab|\.circleci)$/i, "CI/CD workflows"],
  [/^(docker|containers?)$/i, "Container definitions"],
  [/^(web|frontend|client)$/i, "Front-end application"],
  [/^(server|backend|worker|workers)$/i, "Back-end application"],
  [/^(packages|apps|modules)$/i, "Monorepo workspace members"],
];

const STACK_FILES: [RegExp, string][] = [
  [/^package\.json$/, "Node.js / npm"],
  [/^next\.config\./, "Next.js"],
  [/^(vite|nuxt|astro|svelte|remix|angular)\.config\.|^angular\.json$/, "JavaScript front-end framework"],
  [/^tsconfig\.json$/, "TypeScript"],
  [/^(requirements\.txt|pyproject\.toml|setup\.py|Pipfile)$/, "Python"],
  [/^go\.mod$/, "Go"],
  [/^Cargo\.toml$/, "Rust"],
  [/^(pom\.xml|build\.gradle(\.kts)?)$/, "Java / JVM"],
  [/^Gemfile$/, "Ruby"],
  [/^composer\.json$/, "PHP"],
  [/^Dockerfile/, "Docker"],
  [/^docker-compose(\.\w+)?\.ya?ml$|^compose\.ya?ml$/, "Docker Compose"],
  [/^(main|terraform)\.tf$|\.tf$/, "Terraform"],
  [/^serverless\.ya?ml$/, "Serverless Framework"],
  [/^\.env(\.\w+)?$/, "Environment-based configuration"],
  [/^(Makefile|justfile)$/, "Task runner"],
];

const countDescendantFiles = (e: Entry): number => e.children.reduce((n, c) => n + (c.isDir ? countDescendantFiles(c) : 1), 0);

function extensions(e: Entry): string[] {
  const counts = new Map<string, number>();
  const walk = (x: Entry) => {
    for (const c of x.children) {
      if (c.isDir) walk(c);
      else {
        const m = /\.([A-Za-z0-9]+)$/.exec(c.name);
        if (m) counts.set(m[1].toLowerCase(), (counts.get(m[1].toLowerCase()) ?? 0) + 1);
      }
    }
  };
  walk(e);
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([ext]) => `.${ext}`);
}

export function treeToImport(text: string): ImportResult | null {
  if (!looksLikeTree(text)) return null;
  let entries = parseEntries(text);
  if (entries.length === 0) return null;
  const warnings: string[] = [];

  // A single top-level folder is the project root; otherwise invent one.
  let rootName = "project";
  if (entries.length === 1 && entries[0].isDir) {
    rootName = entries[0].name;
    entries = entries[0].children;
  }
  const root: Entry = { name: rootName, depth: -1, isDir: true, children: entries, path: "" };

  const nodes: GNode[] = [{ id: "root", label: rootName, subtitle: `${countDescendantFiles(root)} files`, icon: "lucide:FolderTree" }];
  const edges: GEdge[] = [];
  let n = 0;
  const MAX_NODES = 60;
  const add = (e: Entry, parentId: string, level: number) => {
    for (const child of e.children) {
      if (!child.isDir) continue;
      if (nodes.length >= MAX_NODES) {
        warnings.push(`Only the first ${MAX_NODES} folders were drawn.`);
        return;
      }
      const id = `d${++n}`;
      const files = countDescendantFiles(child);
      const exts = extensions(child);
      nodes.push({ id, label: child.name, subtitle: `${files} file${files === 1 ? "" : "s"}${exts.length ? ` · ${exts.join(" ")}` : ""}`, icon: "lucide:Folder" });
      edges.push({ from: parentId, to: id });
      if (level < 3) add(child, id, level + 1);
    }
  };
  add(root, "root", 1);
  // notable root files hang off the root
  for (const f of root.children.filter((c) => !c.isDir && STACK_FILES.some(([re]) => re.test(c.name))).slice(0, 8)) {
    if (nodes.length >= MAX_NODES) break;
    const id = `f${++n}`;
    nodes.push({ id, label: f.name, icon: "lucide:FileText" });
    edges.push({ from: "root", to: id });
  }
  if (nodes.length < 2) return null;

  const title = `${rootName} structure`;
  const { graph, warnings: more } = normalizeGraph({ kind: "mindmap", title, direction: "right", nodes, groups: [], edges } as Graph, "mindmap");
  return { source: "tree", title, graph, markdown: treeMarkdown(title, rootName, root, text), warnings: [...warnings, ...more] };
}

function treeMarkdown(title: string, rootName: string, root: Entry, original: string): string {
  const out: string[] = [`# ${title}`, "", `> Generated by Slate from a directory listing: ${countDescendantFiles(root)} files.`, ""];

  const stack = new Set<string>();
  const walk = (e: Entry) => {
    for (const c of e.children) {
      if (c.isDir) walk(c);
      else for (const [re, label] of STACK_FILES) if (re.test(c.name)) stack.add(label);
    }
  };
  walk(root);
  if (stack.size) out.push("## Detected stack", "", ...Array.from(stack).map((s) => `- ${s}`), "");

  const dirs = root.children.filter((c) => c.isDir);
  if (dirs.length) {
    out.push(
      "## Top-level folders",
      "",
      table(
        ["Folder", "Purpose", "Files"],
        dirs.map((d) => [code(`${d.name}/`), PURPOSE.find(([re]) => re.test(d.name))?.[1] ?? "—", countDescendantFiles(d)])
      ),
      ""
    );
  }
  const keyFiles = root.children.filter((c) => !c.isDir && STACK_FILES.some(([re]) => re.test(c.name)));
  if (keyFiles.length) out.push("## Key files", "", ...keyFiles.map((f) => `- ${code(f.name)}: ${STACK_FILES.find(([re]) => re.test(f.name))![1]}`), "");

  out.push("## Structure", "", "```text", original.trim().split(/\r?\n/).slice(0, 120).join("\n"), original.trim().split(/\r?\n/).length > 120 ? "…" : "", "```", "");
  void rootName;
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
