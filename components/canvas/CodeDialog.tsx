"use client";

import * as React from "react";
import { AlertCircle, Check, ClipboardCopy, Loader2, MousePointerSquareDashed, Play, RefreshCw } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Engine } from "@/lib/canvas/engine";
import { DSL_EXAMPLE, graphToDsl, parseDsl } from "@/lib/diagram/dsl";
import { graphFromElements } from "@/lib/diagram/extract";
import { normalizeGraph } from "@/lib/diagram/graph";
import { placeGraph } from "@/lib/diagram/insert";
import { TEMPLATES } from "@/lib/diagram/templates";

const REFERENCE = `Node [icon: postgresql, color: blue, subtitle: "text"]
Group [color: green] { Node A, Node B }
A > B: label        arrow         A < B     back
A <> B              two-way       A - B     line
A --> B             dashed arrow  A -- B    dashed line
A, B > C            fan-in        A > B > C chain
type flowchart | erd | mindmap | sequence
direction right | down      title My system`;

interface Initial {
  code?: string;
  replaceDiagramId?: string;
}

export function CodeDialog({ engine, open, onOpenChange, initial }: { engine: Engine; open: boolean; onOpenChange: (o: boolean) => void; initial?: Initial }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <CodeBody engine={engine} onOpenChange={onOpenChange} initial={initial} />}
    </Dialog>
  );
}

function CodeBody({ engine, onOpenChange, initial }: { engine: Engine; onOpenChange: (o: boolean) => void; initial?: Initial }) {
  const [code, setCode] = React.useState(initial?.code ?? DSL_EXAMPLE);
  const [replaceId, setReplaceId] = React.useState<string | undefined>(initial?.replaceDiagramId);
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [parsed, setParsed] = React.useState(() => parseDsl(initial?.code ?? DSL_EXAMPLE));

  React.useEffect(() => {
    const t = setTimeout(() => setParsed(parseDsl(code)), 150);
    return () => clearTimeout(t);
  }, [code]);

  const { graph, errors } = parsed;
  const ok = errors.length === 0 && graph.nodes.length > 0;

  const apply = async (replace: string | undefined) => {
    setBusy(true);
    setMessage(null);
    try {
      const g = normalizeGraph(graph, graph.kind).graph;
      if (g.nodes.length === 0) throw new Error("Add at least one component first.");
      await placeGraph(engine, g, { replaceDiagramId: replace });
      onOpenChange(false);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not create the diagram");
    } finally {
      setBusy(false);
    }
  };

  const fromSelection = () => {
    const els = engine.selectedElements();
    const pool = els.length ? els : engine.store.list();
    const g = graphFromElements(pool);
    if (g.nodes.length === 0) {
      setMessage("Select some nodes (cards or labelled shapes) first.");
      return;
    }
    setCode(graphToDsl(g));
    setReplaceId(undefined);
    setMessage(null);
  };

  return (
    <>
      <DialogContent className="max-h-[90vh] max-w-[900px] gap-3 overflow-hidden rounded-2xl border border-white/10 bg-[#111113] p-5 text-white sm:max-w-[900px]">
        <DialogHeader className="gap-1">
          <DialogTitle className="text-base font-semibold">Diagram as code</DialogTitle>
          <DialogDescription className="text-xs text-zinc-500">Describe a system in text. Slate lays it out automatically, with no overlaps, and every element stays editable.</DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 gap-4 md:grid-cols-[1fr_230px]">
          <div className="flex min-h-0 flex-col gap-2">
            <textarea
              value={code}
              onChange={(e) => setCode(e.target.value)}
              spellCheck={false}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Tab") {
                  e.preventDefault();
                  const t = e.currentTarget;
                  const s = t.selectionStart;
                  setCode(code.slice(0, s) + "  " + code.slice(t.selectionEnd));
                  requestAnimationFrame(() => t.setSelectionRange(s + 2, s + 2));
                }
                if ((e.ctrlKey || e.metaKey) && e.key === "Enter") void apply(replaceId);
              }}
              className="h-[380px] w-full resize-none rounded-xl border border-white/10 bg-black/40 p-3 font-mono text-[12.5px] leading-relaxed text-zinc-200 outline-none focus:border-white/25"
            />
            <div className="flex min-h-[20px] items-center gap-2 text-[11.5px]">
              {errors.length > 0 ? (
                <span className="flex items-center gap-1.5 text-red-300">
                  <AlertCircle className="h-3.5 w-3.5" /> Line {errors[0].line}: {errors[0].message}
                </span>
              ) : (
                <span className="text-zinc-500">
                  {graph.nodes.length} components · {graph.kind === "sequence" ? graph.messages?.length ?? 0 : graph.edges.length} {graph.kind === "sequence" ? "messages" : "connections"} · {graph.groups.length} groups
                </span>
              )}
              {message && <span className="text-amber-300">{message}</span>}
            </div>
          </div>
          <div className="flex min-h-0 flex-col gap-3 overflow-y-auto text-xs [scrollbar-width:thin]">
            <div className="grid gap-1.5">
              <button type="button" disabled={!ok || busy} onClick={() => void apply(undefined)} className="flex items-center justify-center gap-2 rounded-xl bg-white px-3 py-2 text-[13px] font-semibold text-black transition-colors hover:bg-zinc-200 disabled:opacity-40">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                Insert diagram
              </button>
              {replaceId && (
                <button type="button" disabled={!ok || busy} onClick={() => void apply(replaceId)} className="flex items-center justify-center gap-2 rounded-xl border border-indigo-400/40 bg-indigo-500/15 px-3 py-2 text-[13px] font-semibold text-indigo-100 transition-colors hover:bg-indigo-500/25 disabled:opacity-40">
                  <RefreshCw className="h-4 w-4" /> Update that diagram
                </button>
              )}
              <button type="button" onClick={fromSelection} className="flex items-center justify-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-[12.5px] font-medium text-zinc-300 hover:bg-white/10">
                <MousePointerSquareDashed className="h-4 w-4" /> Load from selection
              </button>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(code);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
                className="flex items-center justify-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-[12.5px] font-medium text-zinc-300 hover:bg-white/10"
              >
                {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <ClipboardCopy className="h-4 w-4" />} Copy code
              </button>
            </div>
            <div>
              <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-zinc-500">Templates</div>
              <div className="flex flex-wrap gap-1.5">
                {TEMPLATES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      setCode(t.dsl.trim());
                      setReplaceId(undefined);
                    }}
                    className="rounded-lg bg-white/5 px-2 py-1 text-[11px] text-zinc-300 hover:bg-white/10"
                  >
                    {t.title}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-zinc-500">Syntax</div>
              <pre className="whitespace-pre-wrap rounded-lg bg-black/40 p-2 font-mono text-[10.5px] leading-relaxed text-zinc-500">{REFERENCE}</pre>
            </div>
          </div>
        </div>
      </DialogContent>
    </>
  );
}
