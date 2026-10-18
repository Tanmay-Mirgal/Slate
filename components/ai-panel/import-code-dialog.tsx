"use client";

import * as React from "react";
import { AlertTriangle, CheckCircle2, FileInput, FileText, Loader2, Sparkles, Upload } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ClientAiError, requestCodeImport, type CodeImportResponse } from "@/lib/ai/client";
import { detectSource, MAX_SOURCE_CHARS } from "@/lib/import";
import { placeGraph } from "@/lib/diagram/insert";
import type { DocBridge } from "@/components/editor/doc-bridge";
import type { Engine } from "@/lib/canvas/engine";

const SAMPLES = {
  compose: `name: shop
services:
  web:
    image: nginx:1.27-alpine
    ports: ["8080:80"]
    depends_on: [api]
  api:
    build: ./api
    ports: ["3000:3000"]
    environment:
      DATABASE_URL: postgres://shop:\${DB_PASSWORD}@db:5432/shop
      REDIS_HOST: cache
      JWT_SECRET: \${JWT_SECRET:?required}
    depends_on: [db, cache]
  worker:
    build: ./worker
    deploy:
      replicas: 2
    environment:
      - AMQP_URL=amqp://queue:5672
    depends_on: [queue, db]
  db:
    image: postgres:16
    volumes:
      - pgdata:/var/lib/postgresql/data
  cache:
    image: redis:7
  queue:
    image: rabbitmq:3-management
volumes:
  pgdata: {}
`,
  sql: `CREATE TABLE users (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  name text
);
CREATE TABLE projects (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES users(id),
  name text NOT NULL
);
CREATE TABLE tasks (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id),
  assignee_id uuid REFERENCES users(id),
  title text NOT NULL,
  done boolean DEFAULT false
);
`,
  tree: `my-app/
├── app/
│   ├── dashboard/
│   │   └── page.tsx
│   └── api/
│       └── route.ts
├── components/
│   └── Button.tsx
├── lib/
│   └── utils.ts
├── Dockerfile
└── package.json
`,
};

const DETECTED = {
  compose: { label: "Docker Compose detected", hint: "Parsed exactly: services, ports, networks and volumes. No AI credits used.", tone: "ok" },
  sql: { label: "SQL schema detected", hint: "Parsed exactly into an ER diagram with keys and relationships. No AI credits used.", tone: "ok" },
  tree: { label: "Directory tree detected", hint: "Parsed exactly into a project map. No AI credits used.", tone: "ok" },
  unknown: { label: "Treated as code or notes", hint: "Slate AI will read it and draw the architecture. Uses 1 AI credit.", tone: "ai" },
} as const;

interface ImportCodeDialogProps {
  engine: Engine;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  signedIn: boolean;
  docBridge?: DocBridge;
  /** Switches the board to split view so the new documentation is visible. */
  onShowDoc?: () => void;
  /** Called after the diagram is on the board. */
  onImported: (res: CodeImportResponse, placed: { diagramId: string; summary: string }) => void;
  onUpgrade?: () => void;
}

export function ImportCodeDialog({ engine, open, onOpenChange, signedIn, docBridge, onShowDoc, onImported, onUpgrade }: ImportCodeDialogProps) {
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [writeDocs, setWriteDocs] = React.useState(true);
  const [error, setError] = React.useState<{ message: string; code?: string } | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);
  const fileRef = React.useRef<HTMLInputElement | null>(null);

  const detected = DETECTED[detectSource(text)];
  const tooLong = text.length > MAX_SOURCE_CHARS;
  const canWriteDocs = !!docBridge && !!onShowDoc;

  const close = (next: boolean) => {
    if (!next) {
      abortRef.current?.abort();
      setError(null);
    }
    onOpenChange(next);
  };

  const readFile = async (file: File) => {
    if (file.size > MAX_SOURCE_CHARS * 2) {
      setError({ message: "That file is too large. Paste the relevant part instead." });
      return;
    }
    setError(null);
    setText(await file.text());
  };

  const run = async () => {
    if (!text.trim() || busy) return;
    if (!signedIn) {
      setError({ message: "Sign in to import code.", code: "unauthenticated" });
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setError(null);
    try {
      const res = await requestCodeImport(text, { signal: controller.signal });
      const placed = await placeGraph(engine, res.graph);
      if (writeDocs && canWriteDocs) {
        onShowDoc?.();
        docBridge?.insertMarkdown(res.markdown);
      }
      onImported(res, { diagramId: placed.diagramId, summary: placed.summary });
      setText("");
      onOpenChange(false);
    } catch (e) {
      const err = e instanceof ClientAiError ? e : new ClientAiError("layout", e instanceof Error ? e.message : "Something went wrong");
      if (err.code !== "aborted") setError({ message: err.message, code: err.code });
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="gap-4 rounded-2xl border border-white/10 bg-[#111113] p-5 text-white sm:max-w-[640px]">
        <DialogHeader className="gap-1">
          <DialogTitle className="flex items-center gap-2 text-base font-semibold">
            <FileInput className="h-4 w-4" /> Import code / Docker Compose
          </DialogTitle>
          <DialogDescription className="text-xs text-zinc-500">Paste a docker-compose.yml, a SQL schema, a folder tree or any code. Slate draws the diagram and writes the documentation beside it.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
          <span className="text-zinc-500">Try a sample:</span>
          {(["compose", "sql", "tree"] as const).map((k) => (
            <button key={k} type="button" onClick={() => setText(SAMPLES[k])} className="rounded-lg border border-white/10 px-2 py-1 font-medium text-zinc-300 hover:bg-white/10">
              {k === "compose" ? "docker-compose.yml" : k === "sql" ? "SQL schema" : "Folder tree"}
            </button>
          ))}
          <button type="button" onClick={() => fileRef.current?.click()} className="ml-auto flex items-center gap-1.5 rounded-lg border border-white/10 px-2 py-1 font-medium text-zinc-300 hover:bg-white/10">
            <Upload className="h-3 w-3" /> Upload file
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".yml,.yaml,.sql,.txt,.md,.json,.tf,.py,.js,.ts,.go,.java,.rb,text/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void readFile(f);
              e.target.value = "";
            }}
          />
        </div>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
          spellCheck={false}
          rows={13}
          aria-label="Source to import"
          placeholder={"services:\n  web:\n    image: nginx\n  db:\n    image: postgres:16"}
          className="w-full resize-y rounded-xl border border-white/10 bg-black/40 p-3 font-mono text-[12px] leading-relaxed text-zinc-200 outline-none placeholder:text-zinc-700 focus:border-indigo-400/60"
        />

        <div className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-[12px] ${text.trim() ? (detected.tone === "ok" ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-200" : "border-indigo-400/20 bg-indigo-500/5 text-indigo-200") : "border-white/[0.07] text-zinc-500"}`}>
          {text.trim() ? detected.tone === "ok" ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
          <span>{text.trim() ? <><strong className="font-semibold">{detected.label}.</strong> {detected.hint}</> : "Nothing pasted yet."}</span>
          {tooLong && <span className="ml-auto text-amber-300">Too long</span>}
        </div>

        <label className={`flex items-center gap-2 text-[12.5px] ${canWriteDocs ? "text-zinc-300" : "text-zinc-600"}`}>
          <input type="checkbox" checked={writeDocs && canWriteDocs} disabled={!canWriteDocs} onChange={(e) => setWriteDocs(e.target.checked)} className="h-3.5 w-3.5 accent-indigo-500" />
          Write the documentation into the document pane {canWriteDocs ? "(opens split view)" : "(open a saved board to use this)"}
        </label>

        {error && (
          <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-[12.5px] text-red-200">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div className="flex-1">
              {error.message}
              {error.code === "credits_exhausted" && onUpgrade && (
                <button type="button" onClick={onUpgrade} className="mt-1.5 block rounded-lg bg-white px-2.5 py-1 text-[11.5px] font-semibold text-black hover:bg-zinc-200">
                  See plans
                </button>
              )}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] text-zinc-600">{text.length.toLocaleString()} / {MAX_SOURCE_CHARS.toLocaleString()} characters</span>
          <div className="flex gap-2">
            {busy && (
              <button type="button" onClick={() => abortRef.current?.abort()} className="h-9 rounded-xl border border-white/10 px-3 text-[12.5px] font-semibold text-zinc-300 hover:bg-white/10">
                Cancel
              </button>
            )}
            <button type="button" disabled={!text.trim() || busy || tooLong} onClick={() => void run()} className="flex h-9 items-center gap-2 rounded-xl bg-white px-4 text-[12.5px] font-semibold text-black hover:bg-zinc-200 disabled:opacity-40">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {busy ? "Working…" : "Generate diagram & docs"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
