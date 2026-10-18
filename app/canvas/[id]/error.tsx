"use client";

import Link from "next/link";
import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";

type Kind = "bad-id" | "backend-outdated" | "other";

function classify(message: string): Kind {
  // Convex reports a missing function as: Could not find public function for 'elements:list'
  if (/could not find (public|internal) function|is not a function|elements:list|presence:(join|list)/i.test(message)) return "backend-outdated";
  if (/invalid|decode|validator|argument/i.test(message)) return "bad-id";
  return "other";
}

const COPY: Record<Kind, { title: string; body: string }> = {
  "bad-id": {
    title: "That board link isn’t valid",
    body: "Check the link you were given, or open the board from your dashboard.",
  },
  "backend-outdated": {
    title: "The backend needs to be updated",
    body: "This version of the app calls functions that aren’t deployed to your Convex backend yet. If you run this site, deploy the Convex functions (npx convex deploy) and reload.",
  },
  other: {
    title: "Something went wrong opening this board",
    body: "Your work is safe. Try again, and if it keeps happening, reload the page.",
  },
};

/** Shown for malformed board ids and unexpected runtime errors instead of a blank crash. */
export default function CanvasError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[canvas]", error);
  }, [error]);
  const kind = classify(error.message ?? "");
  const { title, body } = COPY[kind];
  // Client-side errors keep their message in production; server errors are redacted to a digest.
  const detail = (error.message || "").replace(/\s+/g, " ").trim().slice(0, 400);

  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center gap-4 bg-[#0a0a0a] px-6 text-center text-white">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-red-500/10">
        <AlertTriangle className="h-5 w-5 text-red-400" />
      </div>
      <h1 className="text-lg font-semibold">{title}</h1>
      <p className="max-w-md text-sm text-zinc-500">{body}</p>
      <div className="flex gap-2">
        {kind !== "bad-id" && (
          <button type="button" onClick={reset} className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-zinc-200">
            Try again
          </button>
        )}
        <Link href="/dashboard" className="rounded-xl border border-white/15 px-4 py-2 text-sm font-semibold text-zinc-200 hover:bg-white/10">
          Go to dashboard
        </Link>
      </div>
      {(detail || error.digest) && (
        <details className="mt-2 max-w-lg text-left text-xs text-zinc-600">
          <summary className="cursor-pointer text-center hover:text-zinc-400">Technical details</summary>
          <pre className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-white/[0.03] p-3 font-mono text-[11px] leading-relaxed text-zinc-400">
            {detail}
            {error.digest ? `\n(digest ${error.digest})` : ""}
          </pre>
        </details>
      )}
    </div>
  );
}
