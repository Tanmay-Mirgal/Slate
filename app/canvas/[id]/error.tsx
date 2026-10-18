"use client";

import Link from "next/link";
import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";

/** Shown for malformed board ids and unexpected runtime errors instead of a blank crash. */
export default function CanvasError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[canvas]", error);
  }, [error]);
  const badId = /invalid|decode|validator|argument/i.test(error.message);
  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center gap-4 bg-[#0a0a0a] px-6 text-center text-white">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-red-500/10">
        <AlertTriangle className="h-5 w-5 text-red-400" />
      </div>
      <h1 className="text-lg font-semibold">{badId ? "That board link isn’t valid" : "Something went wrong opening this board"}</h1>
      <p className="max-w-sm text-sm text-zinc-500">{badId ? "Check the link you were given, or open the board from your dashboard." : "Your work is safe. Try again, and if it keeps happening, reload the page."}</p>
      <div className="flex gap-2">
        {!badId && (
          <button type="button" onClick={reset} className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-zinc-200">
            Try again
          </button>
        )}
        <Link href="/dashboard" className="rounded-xl border border-white/15 px-4 py-2 text-sm font-semibold text-zinc-200 hover:bg-white/10">
          Go to dashboard
        </Link>
      </div>
    </div>
  );
}
