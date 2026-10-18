"use client";

import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";

const PlaygroundClient = dynamic(() => import("./PlaygroundClient"), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen w-screen items-center justify-center bg-[#0a0a0a] text-zinc-500">
      <Loader2 className="h-5 w-5 animate-spin" />
    </div>
  ),
});

export default function PlaygroundPage() {
  return <PlaygroundClient />;
}
