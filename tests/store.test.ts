import { describe, expect, it, vi } from "vitest";
import { DocStore } from "@/lib/canvas/store";
import type { El, Op, ShapeEl } from "@/lib/canvas/types";
import { normalizeElement } from "@/lib/canvas/normalize";

const shape = (id: string, x = 0, y = 0, z = 0): ShapeEl => ({ id, type: "shape", shape: "rect", x, y, w: 100, h: 50, z });

describe("DocStore", () => {
  it("groups a gesture into one undo step", () => {
    const s = new DocStore();
    s.put(shape("a"));
    s.begin();
    s.patch("a", { x: 10 });
    s.patch("a", { x: 20 });
    s.patch("a", { x: 30 });
    s.end();
    expect(s.get("a")!.x).toBe(30);
    s.undo();
    expect(s.get("a")!.x).toBe(0);
    s.redo();
    expect(s.get("a")!.x).toBe(30);
  });

  it("undo of a create removes the element and redo restores it", () => {
    const s = new DocStore();
    s.put(shape("a"));
    s.undo();
    expect(s.get("a")).toBeUndefined();
    s.redo();
    expect(s.get("a")).toBeDefined();
  });

  it("undo only touches elements the user changed", async () => {
    vi.useFakeTimers();
    const s = new DocStore();
    s.commit = async () => {};
    s.putMany([shape("a"), shape("b")]);
    s.patch("a", { x: 5 });
    // writes flush, then the post-ack protection window lapses
    await vi.advanceTimersByTimeAsync(3000);
    // a teammate edits b remotely
    s.applyRemote(
      [
        { el: shape("a", 5), rev: 2 },
        { el: shape("b", 999), rev: 2 },
      ],
      true
    );
    expect(s.get("b")!.x).toBe(999);
    s.undo(); // undoes our move of "a" only
    vi.useRealTimers();
    expect(s.get("a")!.x).toBe(0);
    expect(s.get("b")!.x).toBe(999);
  });

  it("does not record history for no-op changes", () => {
    const s = new DocStore();
    s.put(shape("a"));
    s.patch("a", { x: 0 });
    s.undo(); // undoes the creation, not the no-op
    expect(s.get("a")).toBeUndefined();
  });

  it("ignores remote echoes of elements being edited locally", () => {
    const s = new DocStore();
    s.put(shape("a"));
    s.begin();
    s.patch("a", { x: 50 });
    s.applyRemote([{ el: shape("a", 0), rev: 1 }], true);
    expect(s.get("a")!.x).toBe(50);
    s.end();
  });

  it("applies remote deletions only for ids previously known from the server", () => {
    const s = new DocStore();
    s.applyRemote([{ el: shape("a"), rev: 1 }, { el: shape("b"), rev: 1 }], true);
    s.applyRemote([{ el: shape("a"), rev: 1 }], true);
    expect(s.get("b")).toBeUndefined();
    s.load([]);
    s.put(shape("local-only"));
    s.applyRemote([], true);
    expect(s.get("local-only")).toBeDefined();
  });

  it("batches writes into a single commit", async () => {
    vi.useFakeTimers();
    const s = new DocStore();
    const commits: Op[][] = [];
    s.commit = async (ops) => {
      commits.push(ops);
    };
    s.begin();
    for (let i = 0; i < 50; i++) s.put(shape(`n${i}`, i));
    s.end();
    s.patch("n0", { x: 123 });
    await vi.advanceTimersByTimeAsync(100);
    vi.useRealTimers();
    expect(commits).toHaveLength(1);
    expect(commits[0]).toHaveLength(50);
    const n0 = commits[0].find((o) => o.t === "put" && o.el.id === "n0");
    expect(n0 && n0.t === "put" && n0.el.x).toBe(123);
    expect(s.syncState).toBe("saved");
  });

  it("retries failed commits without losing edits", async () => {
    vi.useFakeTimers();
    const s = new DocStore();
    let attempts = 0;
    s.commit = async () => {
      attempts++;
      if (attempts === 1) throw new Error("offline");
    };
    s.put(shape("a"));
    await vi.advanceTimersByTimeAsync(100);
    expect(s.syncState).toBe("error");
    await vi.advanceTimersByTimeAsync(5000);
    vi.useRealTimers();
    expect(attempts).toBe(2);
    expect(s.syncState).toBe("saved");
    expect(s.hasPending()).toBe(false);
  });

  it("keeps the paint order cache correct when only non-z props change", () => {
    const s = new DocStore();
    s.putMany([shape("a", 0, 0, 1), shape("b", 0, 0, 2), shape("c", 0, 0, 3)]);
    expect(s.list().map((e) => e.id)).toEqual(["a", "b", "c"]);
    s.patch("b", { x: 77 });
    expect(s.list().find((e) => e.id === "b")!.x).toBe(77);
    s.patch("a", { z: 10 });
    expect(s.list().map((e) => e.id)).toEqual(["b", "c", "a"]);
  });

  it("read-only stores reject edits", () => {
    const s = new DocStore();
    s.readOnly = true;
    s.put(shape("a"));
    expect(s.size).toBe(0);
  });
});

describe("normalizeElement", () => {
  it("drops unknown types and junk", () => {
    expect(normalizeElement(null)).toBeNull();
    expect(normalizeElement({ id: "x", type: "bogus" })).toBeNull();
    expect(normalizeElement({ type: "shape" })).toBeNull();
  });

  it("sanitises numbers and strips unknown fields", () => {
    const el = normalizeElement({
      id: "x",
      type: "shape",
      shape: "nope",
      x: Number.NaN,
      y: 1e99,
      w: -5,
      h: 10,
      z: 2,
      evil: "<script>",
    }) as El;
    expect(el.type).toBe("shape");
    expect(el.x).toBe(0);
    expect(el.y).toBe(1e7);
    expect(el.w).toBe(0);
    expect((el as unknown as Record<string, unknown>).evil).toBeUndefined();
    expect((el as ShapeEl).shape).toBe("rect");
  });

  it("requires a drawable pen stroke and an image source", () => {
    expect(normalizeElement({ id: "p", type: "pen", pts: [1] })).toBeNull();
    expect(normalizeElement({ id: "i", type: "image" })).toBeNull();
    expect(normalizeElement({ id: "p", type: "pen", pts: [0, 0, 5, 5] })).not.toBeNull();
  });
});
