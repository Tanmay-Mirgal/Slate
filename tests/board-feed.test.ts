import { describe, expect, it } from "vitest";
import { BoardFeed } from "@/lib/client/board-feed";

const row = (eid: string, rev = 1, z = 1, extra: object = {}) => ({ eid, z, rev, data: JSON.stringify({ id: eid, type: "shape", shape: "rect", x: 0, y: 0, w: 10, h: 10, z, ...extra }) });
const ids = (f: BoardFeed) => f.list().map((r) => r.el.id).sort();

describe("BoardFeed", () => {
  it("takes a full load, then deltas", () => {
    const f = new BoardFeed();
    expect(f.loaded).toBe(false);
    expect(f.applySync({ full: true, cursor: 3, puts: [row("a"), row("b")], dels: [] })).toBe(true);
    expect(f.loaded).toBe(true);
    expect(f.cursor).toBe(3);
    expect(ids(f)).toEqual(["a", "b"]);
    expect(f.applySync({ full: false, cursor: 5, puts: [row("c")], dels: ["a"] })).toBe(true);
    expect(ids(f)).toEqual(["b", "c"]);
    expect(f.cursor).toBe(5);
  });

  it("a full load drops what is no longer on the board, and reports no change when nothing differs", () => {
    const f = new BoardFeed();
    f.applySync({ full: true, cursor: 2, puts: [row("a"), row("b")], dels: [] });
    expect(f.applySync({ full: true, cursor: 2, puts: [row("a"), row("b")], dels: [] })).toBe(false);
    expect(f.applySync({ full: true, cursor: 2, puts: [row("b")], dels: [] })).toBe(true);
    expect(ids(f)).toEqual(["b"]);
  });

  it("only takes rows with a newer revision (the server re-sends recent rows on purpose)", () => {
    const f = new BoardFeed();
    f.applySync({ full: true, cursor: 1, puts: [row("a", 2, 1, { x: 50 })], dels: [] });
    expect(f.applySync({ cursor: 1, puts: [row("a", 2, 1, { x: 50 })], dels: [] })).toBe(false); // same revision
    expect(f.applySync({ cursor: 1, puts: [row("a", 1, 1, { x: 0 })], dels: [] })).toBe(false); // older
    expect(f.applyPush({ cursor: 2, puts: [row("a", 3, 1, { x: 99 })], dels: [] })).toBe(true);
    expect((f.list()[0].el as unknown as { x: number }).x).toBe(99);
    expect(f.list()[0].rev).toBe(3);
  });

  it("never moves the cursor backwards", () => {
    const f = new BoardFeed();
    f.applyPush({ cursor: 9, puts: [row("a")], dels: [] });
    f.applySync({ full: true, cursor: 4, puts: [row("a")], dels: [] });
    expect(f.cursor).toBe(9);
  });

  it("keeps a corrupt row out of the board without losing track of its revision", () => {
    const f = new BoardFeed();
    f.applySync({ full: true, cursor: 1, puts: [{ eid: "bad", z: 1, rev: 1, data: "{not json" }, row("ok")], dels: [] });
    expect(ids(f)).toEqual(["ok"]);
    expect(f.size).toBe(2);
    expect(f.applySync({ cursor: 1, puts: [{ eid: "bad", z: 1, rev: 1, data: "{not json" }], dels: [] })).toBe(false);
  });

  describe("a pushed change is never undone by a reply that was read before it happened", () => {
    it("a delete that arrives before the reply that still contains the element", () => {
      const f = new BoardFeed();
      f.applySync({ full: true, cursor: 2, puts: [row("a"), row("b")], dels: [] });
      f.beginSync(); // a re-join asks for the board again...
      f.applyPush({ cursor: 3, puts: [], dels: ["a"] }); // ...somebody deletes a...
      f.applySync({ full: true, cursor: 2, puts: [row("a"), row("b")], dels: [] }); // ...the reply was read before that
      expect(ids(f)).toEqual(["b"]);
    });

    it("a new element pushed before a full reply that does not have it yet", () => {
      const f = new BoardFeed();
      f.beginSync();
      f.applyPush({ cursor: 5, puts: [row("new")], dels: [] });
      f.applySync({ full: true, cursor: 4, puts: [row("old")], dels: [] });
      expect(ids(f)).toEqual(["new", "old"]);
    });

    it("a newer revision pushed before a reply that carries an older one", () => {
      const f = new BoardFeed();
      f.applySync({ full: true, cursor: 1, puts: [row("a", 1, 1, { x: 1 })], dels: [] });
      f.beginSync();
      f.applyPush({ cursor: 2, puts: [row("a", 2, 1, { x: 2 })], dels: [] });
      f.applySync({ cursor: 1, puts: [row("a", 1, 1, { x: 1 })], dels: [] });
      expect(f.list()[0].rev).toBe(2);
    });

    it("an element deleted by the reply but re-created by a push in between", () => {
      const f = new BoardFeed();
      f.applySync({ full: true, cursor: 1, puts: [row("a")], dels: [] });
      f.beginSync();
      f.applyPush({ cursor: 3, puts: [row("a", 3)], dels: [] });
      f.applySync({ cursor: 2, puts: [], dels: ["a"] });
      expect(ids(f)).toEqual(["a"]);
    });

    it("the protection ends with the reply: a later delete is applied", () => {
      const f = new BoardFeed();
      f.beginSync();
      f.applyPush({ cursor: 1, puts: [row("a")], dels: [] });
      f.applySync({ full: true, cursor: 1, puts: [row("a")], dels: [] });
      expect(f.applySync({ cursor: 2, puts: [], dels: ["a"] })).toBe(true);
      expect(ids(f)).toEqual([]);
    });
  });
});
