"use client";

import * as React from "react";
import { colorFor } from "@/lib/canvas/peers";
import { initialsOf } from "@/lib/comments/format";

/** Round avatar: the photo if there is one, else initials on a colour that is stable per person. */
export function Avatar({ userId, name, src, size = 24 }: { userId: string; name: string; src?: string; size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-bold uppercase text-white"
      style={{ width: size, height: size, background: colorFor(userId), fontSize: Math.max(9, Math.round(size * 0.4)) }}
      title={name}
      aria-hidden
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
      ) : (
        initialsOf(name)
      )}
    </span>
  );
}
