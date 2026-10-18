"use client";

import * as React from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { STARTER_TEMPLATES, type StarterId, type StarterTemplate } from "@/lib/diagram/starter-templates";

/** A tiny abstract picture of each starter, drawn in the card's accent colour. */
function Glyph({ id }: { id: StarterId }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg viewBox="0 0 120 56" className="h-14 w-full" aria-hidden>
      {id === "aws-microservices" && (
        <g {...common}>
          <rect x="6" y="20" width="18" height="16" rx="3" />
          <rect x="44" y="6" width="22" height="14" rx="3" />
          <rect x="44" y="22" width="22" height="14" rx="3" />
          <rect x="44" y="38" width="22" height="14" rx="3" />
          <path d="M24 28h10l4-15h6M34 28h10M34 28l4 17h6" />
          <ellipse cx="96" cy="16" rx="12" ry="5" />
          <path d="M84 16v18c0 3 5 5 12 5s12-2 12-5V16" />
          <path d="M66 13h12M66 45l16-6" />
        </g>
      )}
      {id === "database-erd" && (
        <g {...common}>
          <rect x="6" y="8" width="34" height="22" rx="3" />
          <path d="M6 15h34M12 21h14M12 26h20" />
          <rect x="74" y="4" width="40" height="22" rx="3" />
          <path d="M74 11h40M80 17h16M80 22h24" />
          <rect x="40" y="36" width="34" height="16" rx="3" />
          <path d="M40 43h34M46 48h14" />
          <path d="M40 19h14l4-9h16M57 36V19" />
        </g>
      )}
      {id === "nextjs-stack" && (
        <g {...common}>
          <rect x="6" y="20" width="24" height="16" rx="3" />
          <rect x="48" y="4" width="26" height="16" rx="3" />
          <rect x="48" y="36" width="26" height="16" rx="3" />
          <circle cx="102" cy="28" r="10" />
          <path d="M30 24l18-12M30 32l18 12M74 12l18 12M74 44l18-12" />
        </g>
      )}
      {id === "auth-flow" && (
        <g {...common}>
          <rect x="8" y="4" width="22" height="9" rx="2" />
          <rect x="49" y="4" width="22" height="9" rx="2" />
          <rect x="90" y="4" width="22" height="9" rx="2" />
          <path d="M19 13v39M60 13v39M101 13v39" strokeDasharray="2 3" />
          <path d="M19 22h37m-4-3 4 3-4 3M60 31h37m-4-3 4 3-4 3M101 40H64m4-3-4 3 4 3M60 48H23m4-3-4 3 4 3" />
        </g>
      )}
      {id === "system-design-interview" && (
        <g {...common}>
          <circle cx="36" cy="28" r="20" />
          <path d="M36 15v13l9 6" />
          <path d="M72 14h40M72 26h40M72 38h28" />
          <path d="m64 14 2 2 4-4M64 26l2 2 4-4" />
        </g>
      )}
    </svg>
  );
}

interface TemplateRailProps {
  onPick: (template: StarterTemplate) => void;
  /** Id of the template being created, to show a spinner and block double clicks. */
  busyId?: StarterId | null;
  disabled?: boolean;
}

/** "Quick-start architecture templates": one click clones the template into a new board and opens it. */
export function TemplateRail({ onPick, busyId, disabled }: TemplateRailProps) {
  return (
    <section aria-labelledby="quick-start-heading">
      <div className="mb-3 flex items-end justify-between">
        <div>
          <h2 id="quick-start-heading" className="text-[13px] font-semibold tracking-tight text-white">
            Quick start
          </h2>
          <p className="mt-0.5 text-[12px] text-zinc-500">Clone an architecture and start editing in seconds.</p>
        </div>
      </div>
      <div className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2 [scrollbar-color:rgba(255,255,255,0.18)_transparent] [scrollbar-width:thin]">
        {STARTER_TEMPLATES.map((t) => {
          const busy = busyId === t.id;
          return (
            <button
              key={t.id}
              type="button"
              disabled={disabled || !!busyId}
              onClick={() => onPick(t)}
              style={{ ["--accent" as string]: t.accent }}
              className="group relative w-[232px] shrink-0 snap-start overflow-hidden rounded-2xl border border-white/[0.07] bg-[#121215] p-3.5 text-left outline-none transition-all duration-200 hover:-translate-y-0.5 hover:border-[color:var(--accent)]/50 hover:bg-[#15151a] focus-visible:border-[color:var(--accent)] disabled:cursor-wait disabled:opacity-60"
            >
              <span aria-hidden className="pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full opacity-[0.14] blur-2xl transition-opacity group-hover:opacity-30" style={{ background: t.accent }} />
              <div className="relative rounded-xl border border-white/[0.05] bg-black/30 px-2 py-1" style={{ color: t.accent }}>
                <Glyph id={t.id} />
              </div>
              <h3 className="relative mt-3 flex items-center justify-between text-[13px] font-semibold text-white">
                {t.title}
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-400" /> : <ArrowRight className="h-3.5 w-3.5 -translate-x-1 text-zinc-600 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" />}
              </h3>
              <p className="relative mt-1 line-clamp-2 min-h-[32px] text-[11.5px] leading-snug text-zinc-500">{t.description}</p>
              <div className="relative mt-2.5 flex flex-wrap gap-1">
                {t.tags.map((tag) => (
                  <span key={tag} className="rounded-md border border-white/[0.07] bg-white/[0.03] px-1.5 py-0.5 text-[10px] font-medium text-zinc-400">
                    {tag}
                  </span>
                ))}
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
