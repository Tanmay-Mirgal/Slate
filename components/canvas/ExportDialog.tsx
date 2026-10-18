"use client";

import * as React from "react";
import { Check, ClipboardCopy, Download, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Engine } from "@/lib/canvas/engine";
import { copyPngToClipboard, DEFAULT_EXPORT, downloadBlob, exportJson, exportPng, exportSvg, safeFilename, type ExportOptions } from "@/lib/canvas/export";
import { useUi } from "./hooks";

type Format = "png" | "svg" | "json";

export function ExportDialog({ engine, open, onOpenChange, title }: { engine: Engine; open: boolean; onOpenChange: (o: boolean) => void; title: string }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <ExportBody engine={engine} title={title} />}
    </Dialog>
  );
}

function ExportBody({ engine, title }: { engine: Engine; title: string }) {
  const ui = useUi(engine);
  const [format, setFormat] = React.useState<Format>("png");
  const [opts, setOpts] = React.useState<ExportOptions>(() => ({ ...DEFAULT_EXPORT, selectionOnly: engine.selection.size > 0 }));
  const [preview, setPreview] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const hasSelection = ui.selection.length > 0;

  React.useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    const t = setTimeout(async () => {
      const blob = await exportPng(engine, { ...opts, scale: 0.6 });
      if (cancelled || !blob) {
        if (!cancelled) setPreview(null);
        return;
      }
      url = URL.createObjectURL(blob);
      setPreview(url);
    }, 160);
    return () => {
      cancelled = true;
      clearTimeout(t);
      if (url) URL.revokeObjectURL(url);
    };
  }, [opts, engine]);

  const empty = engine.store.size === 0;

  const download = async () => {
    setBusy(true);
    try {
      if (format === "png") {
        const blob = await exportPng(engine, opts);
        if (blob) downloadBlob(blob, safeFilename(title, "png"));
      } else if (format === "svg") {
        const svg = exportSvg(engine, opts);
        if (svg) downloadBlob(new Blob([svg], { type: "image/svg+xml" }), safeFilename(title, "svg"));
      } else {
        downloadBlob(new Blob([exportJson(engine, opts.selectionOnly)], { type: "application/json" }), safeFilename(title, "slate.json"));
      }
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    setBusy(true);
    try {
      const blob = await exportPng(engine, opts);
      if (blob && (await copyPngToClipboard(blob))) {
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      } else engine.toast("Your browser blocked clipboard image access", "error");
    } finally {
      setBusy(false);
    }
  };

  const seg = <T extends string | number>(value: T, current: T, set: (v: T) => void, label: string) => (
    <button
      key={String(value)}
      type="button"
      onClick={() => set(value)}
      className={`flex-1 rounded-md px-2 py-1.5 text-xs font-semibold transition-colors ${current === value ? "bg-white text-black" : "text-zinc-400 hover:text-white"}`}
    >
      {label}
    </button>
  );

  return (
    <>
      <DialogContent className="max-w-[760px] gap-0 overflow-hidden rounded-2xl border border-white/10 bg-[#111113] p-0 text-white sm:max-w-[760px]">
        <div className="grid md:grid-cols-[1fr_300px]">
          <div className="flex min-h-[320px] items-center justify-center border-b border-white/10 bg-[linear-gradient(45deg,#18181b_25%,transparent_25%),linear-gradient(-45deg,#18181b_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#18181b_75%),linear-gradient(-45deg,transparent_75%,#18181b_75%)] bg-[length:20px_20px] bg-[position:0_0,0_10px,10px_-10px,-10px_0] p-6 md:border-b-0 md:border-r">
            {empty ? (
              <p className="text-sm text-zinc-500">Nothing to export yet — draw something first.</p>
            ) : preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="Export preview" className="max-h-[360px] max-w-full rounded-lg object-contain shadow-2xl" />
            ) : (
              <Loader2 className="h-5 w-5 animate-spin text-zinc-500" />
            )}
          </div>
          <div className="space-y-4 p-5">
            <DialogHeader className="gap-1">
              <DialogTitle className="text-base font-semibold">Export</DialogTitle>
              <DialogDescription className="text-xs text-zinc-500">Download your diagram or copy it to the clipboard.</DialogDescription>
            </DialogHeader>
            <div>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Format</div>
              <div className="flex gap-1 rounded-lg bg-white/5 p-0.5">
                {seg<Format>("png", format, setFormat, "PNG")}
                {seg<Format>("svg", format, setFormat, "SVG")}
                {seg<Format>("json", format, setFormat, "JSON")}
              </div>
            </div>
            {format === "png" && (
              <div>
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Resolution</div>
                <div className="flex gap-1 rounded-lg bg-white/5 p-0.5">
                  {[1, 2, 3, 4].map((s) => seg(s, opts.scale, (v) => setOpts({ ...opts, scale: v }), `${s}x`))}
                </div>
              </div>
            )}
            {format !== "json" && (
              <div>
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Background</div>
                <div className="flex gap-1 rounded-lg bg-white/5 p-0.5">
                  {seg("solid", opts.transparent ? "clear" : "solid", () => setOpts({ ...opts, transparent: false }), "Solid")}
                  {seg("clear", opts.transparent ? "clear" : "solid", () => setOpts({ ...opts, transparent: true }), "Transparent")}
                </div>
              </div>
            )}
            <div>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Include</div>
              <div className="flex gap-1 rounded-lg bg-white/5 p-0.5">
                {seg("all", opts.selectionOnly ? "sel" : "all", () => setOpts({ ...opts, selectionOnly: false }), "Whole board")}
                <button
                  type="button"
                  disabled={!hasSelection}
                  onClick={() => setOpts({ ...opts, selectionOnly: true })}
                  className={`flex-1 rounded-md px-2 py-1.5 text-xs font-semibold transition-colors disabled:opacity-30 ${opts.selectionOnly ? "bg-white text-black" : "text-zinc-400 hover:text-white"}`}
                >
                  Selection
                </button>
              </div>
            </div>
            {format === "png" && (
              <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-400">
                <input type="checkbox" checked={opts.branding} onChange={(e) => setOpts({ ...opts, branding: e.target.checked })} className="accent-indigo-400" />
                Show Slate branding
              </label>
            )}
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                disabled={busy || empty}
                onClick={download}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-white px-3 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-zinc-200 disabled:opacity-40"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                Download
              </button>
              {format === "png" && (
                <button
                  type="button"
                  disabled={busy || empty}
                  onClick={copy}
                  title="Copy PNG to clipboard"
                  className="flex items-center justify-center rounded-xl border border-white/15 px-3 text-zinc-200 transition-colors hover:bg-white/10 disabled:opacity-40"
                >
                  {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <ClipboardCopy className="h-4 w-4" />}
                </button>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </>
  );
}
