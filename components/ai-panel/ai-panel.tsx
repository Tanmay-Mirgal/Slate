"use client";

import * as React from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import TextareaAutosize from "react-textarea-autosize";
import {
  AlertTriangle,
  Bot,
  Check,
  Cloud,
  Code2,
  Copy,
  CreditCard,
  Database,
  Layout,
  Loader2,
  Lock,
  MapPin,
  MessageSquare,
  Play,
  Send,
  ShoppingCart,
  Sparkles,
  Square,
  Undo2,
  Users,
  Wand2,
  X,
  Box,
} from "lucide-react";
import type { Engine } from "@/lib/canvas/engine";
import { ClientAiError, requestDiagram } from "@/lib/ai/client";
import type { Complexity } from "@/lib/ai/prompt";
import { graphToDsl, parseDsl } from "@/lib/diagram/dsl";
import { commonDiagramId, graphFromElements } from "@/lib/diagram/extract";
import type { DiagramKind, Graph } from "@/lib/diagram/graph";
import { placeGraph } from "@/lib/diagram/insert";
import { matchTemplate, TEMPLATES, type Template } from "@/lib/diagram/templates";
import { useUi } from "@/components/canvas/hooks";
import { PromptCard } from "./prompt-card";

const PROMPTS = [
  { icon: Database, title: "Microservices with API gateway, Redis & PostgreSQL", prompt: "Microservices architecture with an API gateway, auth service, order service, Redis cache and PostgreSQL" },
  { icon: Cloud, title: "AWS web app with ALB, EC2, RDS & CloudFront", prompt: "AWS architecture with CloudFront, an application load balancer, auto-scaled EC2, RDS and S3 inside a VPC" },
  { icon: Lock, title: "OAuth + JWT login sequence", prompt: "Sequence diagram of OAuth 2.0 authorization code flow with PKCE between browser, web app, identity provider and API" },
  { icon: CreditCard, title: "Stripe-like payments platform", prompt: "Payment processing platform like Stripe: API, ledger, fraud checks, card networks, webhooks and reconciliation" },
  { icon: MessageSquare, title: "Real-time chat at scale", prompt: "Real-time chat system with WebSocket gateways, presence, pub/sub fan-out, message storage and push notifications" },
  { icon: ShoppingCart, title: "E-commerce platform", prompt: "Scalable e-commerce platform with catalog, cart, checkout, payments, inventory and fulfilment" },
  { icon: Box, title: "Event-driven order pipeline", prompt: "Event-driven order processing with Kafka, consumers, dead-letter queue and a data warehouse" },
  { icon: Layout, title: "Kubernetes deployment", prompt: "Kubernetes cluster with ingress, services, deployments, config, secrets and monitoring" },
  { icon: Play, title: "Netflix-style video streaming", prompt: "Video streaming platform: upload, transcoding pipeline, CDN, recommendation service and playback analytics" },
  { icon: MapPin, title: "Ride-sharing backend", prompt: "Ride-sharing backend with real-time location, matching, pricing, trips, payments and notifications" },
  { icon: Users, title: "Social feed & graph", prompt: "Social media app with news feed fan-out, social graph, media storage, search and notifications" },
  { icon: Bot, title: "RAG AI assistant", prompt: "AI assistant with document ingestion, embeddings, vector search, reranking and an LLM gateway" },
];

const KINDS: { id: DiagramKind | "auto"; label: string }[] = [
  { id: "auto", label: "Auto" },
  { id: "architecture", label: "Architecture" },
  { id: "flowchart", label: "Flowchart" },
  { id: "erd", label: "ER diagram" },
  { id: "sequence", label: "Sequence" },
  { id: "mindmap", label: "Mind map" },
];

const COMPLEXITIES: { id: Complexity; label: string }[] = [
  { id: "simple", label: "Simple" },
  { id: "standard", label: "Standard" },
  { id: "detailed", label: "Detailed" },
];

type Msg =
  | { id: number; role: "user"; text: string }
  | { id: number; role: "assistant"; kind: "working"; phase: string; model?: string; chars: number }
  | { id: number; role: "assistant"; kind: "result"; title: string; summary: string; dsl: string; model?: string; warnings: string[]; diagramId: string; source: "ai" | "template" }
  | { id: number; role: "assistant"; kind: "error"; code: string; message: string; retry?: number; template?: Template | null; prompt?: string };

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

interface AiPanelProps {
  engine: Engine;
  isOpen: boolean;
  onClose: () => void;
  signedIn: boolean;
  /** Opens the diagram-as-code editor, optionally for an existing diagram. */
  onOpenCode?: (opts?: { code?: string; replaceDiagramId?: string }) => void;
}

export function AiPanel({ engine, isOpen, onClose, signedIn, onOpenCode }: AiPanelProps) {
  const ui = useUi(engine);
  const [input, setInput] = React.useState("");
  const [kind, setKind] = React.useState<DiagramKind | "auto">("auto");
  const [complexity, setComplexity] = React.useState<Complexity>("standard");
  const [messages, setMessages] = React.useState<Msg[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [editMode, setEditMode] = React.useState(true);
  const [prompts, setPrompts] = React.useState<typeof PROMPTS>([]);
  const abortRef = React.useRef<AbortController | null>(null);
  const idRef = React.useRef(1);
  const endRef = React.useRef<HTMLDivElement | null>(null);
  const inputRef = React.useRef<HTMLTextAreaElement | null>(null);
  const [lastDiagram, setLastDiagram] = React.useState<string | null>(null);

  React.useEffect(() => {
    // Random suggestions are picked after mount so server and client markup agree.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPrompts([...PROMPTS].sort(() => 0.5 - Math.random()).slice(0, 4));
  }, []);
  React.useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 250);
  }, [isOpen]);
  React.useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  // The diagram the next prompt would edit: the selected one, else the one most recently generated here.
  const selectedEls = ui.selection.map((id) => engine.store.get(id)).filter(Boolean) as NonNullable<ReturnType<Engine["store"]["get"]>>[];
  const selectedDiagram = commonDiagramId(selectedEls);
  const targetDiagram = selectedDiagram ?? (lastDiagram && engine.store.list().some((e) => e.diagramId === lastDiagram) ? lastDiagram : null);
  const editing = editMode && !!targetDiagram;

  const push = (m: DistributiveOmit<Msg, "id">): number => {
    const id = idRef.current++;
    setMessages((list) => [...list, { ...m, id } as Msg]);
    return id;
  };
  const patch = (id: number, next: Msg) => setMessages((list) => list.map((m) => (m.id === id ? next : m)));

  const insertGraph = async (graph: Graph, replace?: string) => {
    const placed = await placeGraph(engine, graph, { replaceDiagramId: replace });
    setLastDiagram(placed.diagramId);
    return placed;
  };

  const send = async (text?: string) => {
    const prompt = (text ?? input).trim();
    if (!prompt || busy) return;
    if (!signedIn) {
      push({ role: "assistant", kind: "error", code: "unauthenticated", message: "Sign in to generate diagrams with AI. Templates below work without an account.", template: matchTemplate(prompt), prompt });
      return;
    }
    setInput("");
    setBusy(true);
    const replace = editing ? targetDiagram! : undefined;
    let currentDsl: string | undefined;
    if (replace) {
      const els = engine.store.list().filter((e) => e.diagramId === replace);
      const g = graphFromElements(els);
      if (g.nodes.length) currentDsl = graphToDsl(g);
    }
    push({ role: "user", text: prompt });
    const workingId = push({ role: "assistant", kind: "working", phase: "Thinking", chars: 0 });
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await requestDiagram(
        { prompt, kind, complexity, currentDsl },
        {
          signal: controller.signal,
          onStatus: (s) => patch(workingId, { id: workingId, role: "assistant", kind: "working", phase: s.phase === "retry" ? "Refining the diagram" : s.phase === "fallback" ? "Trying another model" : "Thinking", model: s.model, chars: 0 }),
          onProgress: (chars) => setMessages((list) => list.map((m) => (m.id === workingId && m.role === "assistant" && m.kind === "working" ? { ...m, chars } : m))),
        }
      );
      patch(workingId, { id: workingId, role: "assistant", kind: "working", phase: "Laying out", model: res.model, chars: 0 });
      const placed = await insertGraph(res.graph, replace);
      patch(workingId, {
        id: workingId,
        role: "assistant",
        kind: "result",
        title: res.graph.title || "Diagram",
        summary: replace ? `Updated the diagram · ${placed.summary}` : placed.summary,
        dsl: res.dsl,
        model: res.model,
        warnings: res.warnings,
        diagramId: placed.diagramId,
        source: "ai",
      });
    } catch (e) {
      const err = e instanceof ClientAiError ? e : new ClientAiError("layout", e instanceof Error ? e.message : "Something went wrong");
      if (err.code === "aborted") patch(workingId, { id: workingId, role: "assistant", kind: "error", code: "aborted", message: "Stopped." });
      else patch(workingId, { id: workingId, role: "assistant", kind: "error", code: err.code, message: err.message, retry: err.retryAfterSeconds, template: err.code === "not_configured" || err.code === "upstream" || err.code === "rate_limited" ? matchTemplate(prompt) : null, prompt });
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  };

  const insertTemplate = async (t: Template) => {
    if (busy) return;
    setBusy(true);
    const id = push({ role: "assistant", kind: "working", phase: "Laying out", chars: 0 });
    try {
      const { graph } = parseDsl(t.dsl);
      const placed = await insertGraph(graph);
      patch(id, { id, role: "assistant", kind: "result", title: t.title, summary: placed.summary, dsl: t.dsl.trim(), warnings: [], diagramId: placed.diagramId, source: "template" });
    } catch (e) {
      patch(id, { id, role: "assistant", kind: "error", code: "layout", message: e instanceof Error ? e.message : "Could not lay out that template" });
    } finally {
      setBusy(false);
    }
  };

  const showEmpty = messages.length === 0;

  return (
    <aside
      aria-hidden={!isOpen}
      className={`absolute right-0 top-0 z-50 flex h-full w-[400px] max-w-full flex-col border-l border-white/10 bg-[#0c0c0e]/95 shadow-2xl backdrop-blur-xl transition-transform duration-300 ease-out ${isOpen ? "translate-x-0" : "pointer-events-none translate-x-full"}`}
    >
      <div className="flex flex-none items-center justify-between border-b border-white/5 px-4 py-3">
        <span className="flex items-center gap-2 text-sm font-semibold text-white">
          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-fuchsia-500">
            <Sparkles className="h-3.5 w-3.5 text-white" />
          </span>
          Slate AI
        </span>
        <div className="flex items-center gap-1">
          {onOpenCode && (
            <button type="button" onClick={() => onOpenCode()} title="Diagram as code" className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-zinc-400 hover:bg-white/10 hover:text-white">
              <Code2 className="h-3.5 w-3.5" /> Code
            </button>
          )}
          <button type="button" onClick={onClose} aria-label="Close AI panel" className="rounded-lg p-1.5 text-zinc-500 hover:bg-white/10 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto overflow-x-hidden px-4 py-4 [scrollbar-width:thin]">
        {showEmpty && (
          <div className="space-y-5">
            <div>
              <h3 className="text-base font-semibold text-white">What should we draw?</h3>
              <p className="mt-1 text-[13px] leading-relaxed text-zinc-400">
                Describe any system, flow, schema or plan. Slate AI designs it and lays it out so nothing overlaps. Follow up to refine it.
              </p>
            </div>
            {!signedIn && (
              <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-[12.5px] text-amber-200/90">
                <Lock className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  <Link href="/sign-in" className="font-semibold underline underline-offset-2">Sign in</Link> to generate with AI. The templates below work without an account.
                </span>
              </div>
            )}
            <div className="space-y-2">
              {prompts.map((p, i) => (
                <PromptCard key={p.title} delay={0.06 * i} icon={p.icon} title={p.title} onClick={() => void send(p.prompt)} />
              ))}
            </div>
            <div>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Start from a template</div>
              <div className="grid grid-cols-2 gap-2">
                {TEMPLATES.map((t) => (
                  <button key={t.id} type="button" disabled={busy} onClick={() => void insertTemplate(t)} className="rounded-xl border border-white/5 bg-white/[0.03] p-2.5 text-left transition-colors hover:border-white/15 hover:bg-white/[0.07] disabled:opacity-50">
                    <div className="text-[12px] font-semibold leading-tight text-zinc-100">{t.title}</div>
                    <div className="mt-1 line-clamp-2 text-[10.5px] leading-snug text-zinc-500">{t.description}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {messages.map((m) => (
          <MessageView key={m.id} m={m} engine={engine} onOpenCode={onOpenCode} onUseTemplate={insertTemplate} onRetry={(p) => void send(p)} />
        ))}
        <div ref={endRef} />
      </div>

      <div className="flex-none border-t border-white/5 p-3">
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as DiagramKind | "auto")}
            aria-label="Diagram type"
            className="h-7 rounded-lg border border-white/10 bg-white/5 px-2 text-[11.5px] font-medium text-zinc-200 outline-none hover:bg-white/10"
          >
            {KINDS.map((k) => (
              <option key={k.id} value={k.id} className="bg-[#18181b]">
                {k.label}
              </option>
            ))}
          </select>
          <div className="flex h-7 items-center rounded-lg border border-white/10 bg-white/5 p-0.5">
            {COMPLEXITIES.map((c) => (
              <button key={c.id} type="button" onClick={() => setComplexity(c.id)} className={`h-6 rounded-md px-2 text-[11px] font-semibold transition-colors ${complexity === c.id ? "bg-white text-black" : "text-zinc-400 hover:text-white"}`}>
                {c.label}
              </button>
            ))}
          </div>
          {targetDiagram && (
            <button
              type="button"
              onClick={() => setEditMode((v) => !v)}
              title={editMode ? "Your next message edits the selected diagram" : "Your next message creates a new diagram"}
              className={`flex h-7 items-center gap-1.5 rounded-lg border px-2 text-[11px] font-semibold transition-colors ${editing ? "border-indigo-400/40 bg-indigo-500/15 text-indigo-200" : "border-white/10 bg-white/5 text-zinc-400"}`}
            >
              <Wand2 className="h-3 w-3" />
              {editing ? "Editing diagram" : "New diagram"}
            </button>
          )}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
          className="relative flex items-end gap-2 rounded-2xl border border-white/10 bg-[#141416] p-2 transition-colors focus-within:border-white/25"
        >
          <TextareaAutosize
            ref={inputRef}
            minRows={1}
            maxRows={6}
            value={input}
            maxLength={2000}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
              e.stopPropagation();
            }}
            placeholder={editing ? "Describe the change… e.g. “add a cache in front of the database”" : "Describe the diagram you want…"}
            className="w-full resize-none bg-transparent px-2.5 py-2 text-[13px] leading-relaxed text-white outline-none placeholder:text-zinc-600"
          />
          {busy ? (
            <button type="button" onClick={() => abortRef.current?.abort()} aria-label="Stop" className="mb-1 mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-red-500/15 text-red-400 hover:bg-red-500/25">
              <Square className="h-3.5 w-3.5 fill-current" />
            </button>
          ) : (
            <button type="submit" disabled={!input.trim()} aria-label="Send" className="mb-1 mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white text-black transition-opacity hover:bg-zinc-200 disabled:opacity-25">
              <Send className="h-4 w-4" />
            </button>
          )}
        </form>
        <p className="mt-2 px-1 text-[10.5px] text-zinc-600">AI can be wrong. Everything it draws is editable.</p>
      </div>
    </aside>
  );
}

function MessageView({ m, engine, onOpenCode, onUseTemplate, onRetry }: { m: Msg; engine: Engine; onOpenCode?: AiPanelProps["onOpenCode"]; onUseTemplate: (t: Template) => void; onRetry: (prompt: string) => void }) {
  const [showCode, setShowCode] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  if (m.role === "user") {
    return (
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex justify-end">
        <div className="max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-br-md border border-white/10 bg-white/[0.07] px-3.5 py-2.5 text-[13px] leading-relaxed text-white">{m.text}</div>
      </motion.div>
    );
  }

  if (m.kind === "working") {
    return (
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex items-start gap-2.5">
        <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-indigo-300" />
        <div className="text-[13px] text-zinc-300">
          <span>{m.phase}…</span>
          {m.chars > 0 && <span className="ml-2 text-[11px] text-zinc-600">{m.chars.toLocaleString()} chars</span>}
          {m.model && <div className="mt-0.5 text-[10.5px] text-zinc-600">{m.model}</div>}
        </div>
      </motion.div>
    );
  }

  if (m.kind === "error") {
    return (
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={`rounded-xl border p-3 text-[12.5px] leading-relaxed ${m.code === "aborted" ? "border-white/10 bg-white/[0.03] text-zinc-400" : "border-red-500/20 bg-red-500/5 text-red-200"}`}>
        {m.code !== "aborted" && (
          <div className="mb-1 flex items-center gap-1.5 font-semibold">
            <AlertTriangle className="h-3.5 w-3.5" /> {m.code === "rate_limited" ? "Slow down a little" : m.code === "not_configured" ? "AI isn't set up yet" : m.code === "unauthenticated" ? "Sign in required" : "That didn't work"}
          </div>
        )}
        <div>{m.message}</div>
        {m.retry ? <div className="mt-1 text-[11px] opacity-70">Try again in about {m.retry}s.</div> : null}
        <div className="mt-2 flex flex-wrap gap-2">
          {m.template && (
            <button type="button" onClick={() => onUseTemplate(m.template!)} className="rounded-lg bg-white px-2.5 py-1 text-[11.5px] font-semibold text-black hover:bg-zinc-200">
              Insert “{m.template.title}” instead
            </button>
          )}
          {m.prompt && m.code !== "not_configured" && m.code !== "unauthenticated" && m.code !== "aborted" && (
            <button type="button" onClick={() => onRetry(m.prompt!)} className="rounded-lg border border-white/15 px-2.5 py-1 text-[11.5px] font-semibold text-zinc-200 hover:bg-white/10">
              Try again
            </button>
          )}
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-300">
          <Check className="h-3 w-3" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-white">{m.title}</div>
          <div className="mt-0.5 text-[11.5px] leading-snug text-zinc-500">{m.summary}</div>
          {m.model && <div className="mt-0.5 text-[10.5px] text-zinc-600">{m.source === "ai" ? m.model : "Template"}</div>}
        </div>
      </div>
      {m.warnings.length > 0 && (
        <ul className="mt-2 space-y-0.5 rounded-lg bg-amber-500/5 p-2 text-[11px] leading-snug text-amber-200/80">
          {m.warnings.slice(0, 4).map((w) => (
            <li key={w}>• {w}</li>
          ))}
        </ul>
      )}
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        <button type="button" onClick={() => engine.undo()} className="flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-[11px] font-medium text-zinc-300 hover:bg-white/10">
          <Undo2 className="h-3 w-3" /> Undo
        </button>
        <button type="button" onClick={() => setShowCode((v) => !v)} className="flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-[11px] font-medium text-zinc-300 hover:bg-white/10">
          <Code2 className="h-3 w-3" /> {showCode ? "Hide code" : "View code"}
        </button>
        {onOpenCode && (
          <button type="button" onClick={() => onOpenCode({ code: m.dsl, replaceDiagramId: m.diagramId })} className="flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-[11px] font-medium text-zinc-300 hover:bg-white/10">
            <Wand2 className="h-3 w-3" /> Edit as code
          </button>
        )}
      </div>
      {showCode && (
        <div className="relative mt-2">
          <pre className="max-h-56 overflow-auto rounded-lg border border-white/5 bg-black/40 p-2.5 font-mono text-[11px] leading-relaxed text-zinc-300">{m.dsl}</pre>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(m.dsl);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="absolute right-1.5 top-1.5 rounded-md bg-white/10 p-1 text-zinc-300 hover:bg-white/20"
            aria-label="Copy code"
          >
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          </button>
        </div>
      )}
    </motion.div>
  );
}

