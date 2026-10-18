type Status = "loading" | "ready" | "error";

interface Entry {
  img: HTMLImageElement;
  status: Status;
  waiters: Set<() => void>;
}

const cache = new Map<string, Entry>();
const MAX_ENTRIES = 300;

function load(src: string): Entry {
  const existing = cache.get(src);
  if (existing) return existing;
  const img = new Image();
  img.decoding = "async";
  img.crossOrigin = "anonymous";
  const entry: Entry = { img, status: "loading", waiters: new Set() };
  const done = (status: Status) => {
    entry.status = status;
    for (const w of entry.waiters) w();
    entry.waiters.clear();
  };
  img.onload = () => done("ready");
  img.onerror = () => done("error");
  img.src = src;
  if (cache.size >= MAX_ENTRIES) {
    const first = cache.keys().next();
    if (!first.done) cache.delete(first.value);
  }
  cache.set(src, entry);
  return entry;
}

/** Returns the image if decoded; otherwise schedules `onReady` and returns null. */
export function getImage(src: string, onReady: () => void): { img: HTMLImageElement | null; status: Status } {
  const entry = load(src);
  if (entry.status === "ready") return { img: entry.img, status: "ready" };
  if (entry.status === "loading") entry.waiters.add(onReady);
  return { img: null, status: entry.status };
}

export function preloadImages(srcs: string[]): Promise<void> {
  const unique = Array.from(new Set(srcs));
  return Promise.all(
    unique.map(
      (src) =>
        new Promise<void>((resolve) => {
          const e = load(src);
          if (e.status !== "loading") return resolve();
          e.waiters.add(resolve);
        })
    )
  ).then(() => undefined);
}

/** Reads an image file, downsizes it so the longest side is <= maxSide and returns a Blob + natural size. */
export async function prepareImageFile(
  file: File,
  maxSide = 2000,
  quality = 0.88
): Promise<{ blob: Blob; width: number; height: number }> {
  if (file.type === "image/svg+xml" || file.type === "image/gif") {
    const bitmap = await createImageBitmap(file).catch(() => null);
    return { blob: file, width: bitmap?.width ?? 300, height: bitmap?.height ?? 200 };
  }
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, width, height);
  const keepPng = file.type === "image/png";
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not encode image"))), keepPng ? "image/png" : "image/webp", quality)
  );
  return { blob, width, height };
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
