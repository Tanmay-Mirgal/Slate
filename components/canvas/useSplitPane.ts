"use client";

import * as React from "react";
import type { Engine } from "@/lib/canvas/engine";
import { clampSplit, parseSplit, SPLIT_DEFAULT, SPLIT_KEY, splitFromPointer } from "@/lib/canvas/split";

/** How far the pointer must travel before a press on the handle counts as a drag. */
const DRAG_THRESHOLD_PX = 3;

/**
 * State for the draggable document / canvas divider.
 *
 * While the pointer moves, the document pane's width is written straight to the DOM (no React
 * render per move) and the canvas is asked to repaint; the final value is committed to state and
 * localStorage on release. The canvas host's ResizeObserver keeps the backing store in step.
 */
export function useSplitPane(engine: Engine) {
  const [ratio, setRatio] = React.useState(SPLIT_DEFAULT);
  const [dragging, setDragging] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const docRef = React.useRef<HTMLDivElement | null>(null);
  const cleanupRef = React.useRef<(() => void) | null>(null);

  React.useEffect(() => {
    try {
      // Read after mount so server and client markup agree.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRatio(parseSplit(localStorage.getItem(SPLIT_KEY)));
    } catch {
      /* private mode: keep the default */
    }
  }, []);

  React.useEffect(() => () => cleanupRef.current?.(), []);

  const persist = React.useCallback((value: number) => {
    try {
      localStorage.setItem(SPLIT_KEY, String(Math.round(value * 10) / 10));
    } catch {
      /* ignore */
    }
  }, []);

  /** Sets the ratio immediately (presets, keyboard, double-click reset). */
  const commit = React.useCallback(
    (value: number) => {
      const next = clampSplit(value);
      setRatio(next);
      persist(next);
      engine.requestRender();
    },
    [engine, persist]
  );

  const startDrag = React.useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0 || !e.isPrimary) return;
      const container = containerRef.current;
      if (!container) return;
      e.preventDefault();
      cleanupRef.current?.();

      const rect = container.getBoundingClientRect();
      const startX = e.clientX;
      let latest = clampSplit(ratio);
      let frame = 0;
      // A press that never travels is a click (or half of a double-click): it must not raise the
      // pointer-capturing overlay, or the second click would land on the overlay instead of the handle.
      let moved = false;

      const paint = () => {
        frame = 0;
        if (docRef.current) docRef.current.style.width = `${latest}%`;
        engine.requestRender();
      };
      const move = (ev: PointerEvent) => {
        if (!moved) {
          if (Math.abs(ev.clientX - startX) < DRAG_THRESHOLD_PX) return;
          moved = true;
          setDragging(true);
        }
        latest = splitFromPointer(ev.clientX, rect.left, rect.width);
        if (!frame) frame = requestAnimationFrame(paint);
      };
      const cleanup = () => {
        if (frame) cancelAnimationFrame(frame);
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", end);
        window.removeEventListener("pointercancel", end);
        cleanupRef.current = null;
      };
      const end = () => {
        cleanup();
        if (!moved) return;
        setDragging(false);
        commit(latest);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", end);
      window.addEventListener("pointercancel", end);
      cleanupRef.current = cleanup;
    },
    [commit, engine, ratio]
  );

  // Text selection and the I-beam cursor would otherwise flicker across both panes mid-drag.
  React.useEffect(() => {
    if (!dragging) return;
    const prevSelect = document.body.style.userSelect;
    const prevCursor = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    return () => {
      document.body.style.userSelect = prevSelect;
      document.body.style.cursor = prevCursor;
    };
  }, [dragging]);

  return { ratio, dragging, containerRef, docRef, startDrag, commit, reset: () => commit(SPLIT_DEFAULT) };
}
