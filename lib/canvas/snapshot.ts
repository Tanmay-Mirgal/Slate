import type { Engine } from "./engine";
import { exportPng, exportSvg, type ExportOptions } from "./export";

export interface CanvasSnapshot {
  /** Hosted URL when the board can upload images, otherwise a self-contained SVG data URL. */
  src: string;
  alt: string;
  /** How many elements the picture shows. */
  count: number;
  via: "upload" | "inline";
}

/** The document is stored as one Convex field with a hard cap, so inline pictures must stay small. */
const MAX_INLINE_CHARS = 140_000;

const SNAPSHOT_OPTIONS: Omit<ExportOptions, "selectionOnly"> = {
  scale: 2,
  padding: 24,
  transparent: false,
  branding: false,
};

export class SnapshotError extends Error {}

/**
 * Renders the current selection (or the whole board when nothing is selected) as a picture for the
 * document. Uploaded PNGs keep the document small; if uploading isn't available the diagram is
 * embedded as SVG text instead, which stays crisp and compact for typical diagrams.
 */
export async function captureSnapshot(engine: Engine, opts: { alt?: string } = {}): Promise<CanvasSnapshot> {
  const selectionOnly = engine.selection.size > 0;
  const options: ExportOptions = { ...SNAPSHOT_OPTIONS, selectionOnly };
  const count = selectionOnly ? engine.selectedElements().length : engine.store.size;
  if (engine.store.size === 0) throw new SnapshotError("The board is empty, so there is nothing to capture.");
  const alt = opts.alt?.trim() || (selectionOnly ? "Canvas selection" : "Canvas diagram");

  if (engine.imageUploader) {
    try {
      const blob = await exportPng(engine, options);
      if (blob) {
        const src = await engine.imageUploader(blob, "canvas-snapshot.png");
        return { src, alt, count, via: "upload" };
      }
    } catch {
      /* fall through to the inline SVG */
    }
  }

  const svg = exportSvg(engine, options);
  if (!svg) throw new SnapshotError("Could not render the canvas.");
  const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  if (src.length > MAX_INLINE_CHARS) {
    throw new SnapshotError("This drawing is too large to embed without uploading. Select fewer elements and try again.");
  }
  return { src, alt, count, via: "inline" };
}
