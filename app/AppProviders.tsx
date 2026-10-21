"use client";

import { ClerkProvider, useAuth } from "@clerk/nextjs";
import { ReactNode, useEffect, useRef } from "react";
import { resetQueryCache } from "@/lib/client/query";

/** Drops cached answers when someone signs in or out, so one person's data is never shown to the next. */
function QueryCacheGuard() {
  const { isLoaded, userId } = useAuth();
  const last = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!isLoaded) return;
    if (last.current !== undefined && last.current !== userId) resetQueryCache();
    last.current = userId ?? null;
  }, [isLoaded, userId]);
  return null;
}

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ClerkProvider>
      <QueryCacheGuard />
      {children}
    </ClerkProvider>
  );
}
