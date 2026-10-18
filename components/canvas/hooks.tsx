"use client";

import * as React from "react";
import type { Engine, UiState } from "@/lib/canvas/engine";

const EngineContext = React.createContext<Engine | null>(null);

export function EngineProvider({ engine, children }: { engine: Engine; children: React.ReactNode }) {
  return <EngineContext.Provider value={engine}>{children}</EngineContext.Provider>;
}

export function useEngine(): Engine {
  const e = React.useContext(EngineContext);
  if (!e) throw new Error("useEngine must be used inside <EngineProvider>");
  return e;
}

/** Subscribes to the engine's UI snapshot (tool, selection, view, history flags, ...). */
export function useUi(engine?: Engine): UiState {
  const ctx = React.useContext(EngineContext);
  const e = engine ?? ctx;
  if (!e) throw new Error("useUi needs an engine");
  return React.useSyncExternalStore(e.subscribeUi, e.getUi, e.getUi);
}

/** Re-renders when the camera (pan/zoom/size) changes. Prefer imperative subscriptions for hot paths. */
export function useCameraVersion(engine: Engine): number {
  const ref = React.useRef(0);
  const subscribe = React.useCallback(
    (cb: () => void) =>
      engine.subscribeCamera(() => {
        ref.current++;
        cb();
      }),
    [engine]
  );
  return React.useSyncExternalStore(subscribe, () => ref.current, () => 0);
}

export function useEditingVersion(engine: Engine): number {
  const ref = React.useRef(0);
  const subscribe = React.useCallback(
    (cb: () => void) =>
      engine.subscribeEditing(() => {
        ref.current++;
        cb();
      }),
    [engine]
  );
  return React.useSyncExternalStore(subscribe, () => ref.current, () => 0);
}
