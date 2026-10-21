import { describe, expect, it } from "vitest";
import { activeMentionQuery, cleanBody, isUnread, mentionedIn, sanitizeAnchor, searchPeople, snippetOf, splitMentions, uniqueIds } from "@/lib/comments/logic";

const ada = { userId: "u_ada", name: "Ada Lovelace" };
const adam = { userId: "u_adam", name: "Adam" };
const ed = { userId: "u_ed", name: "Ed" };

describe("sanitizeAnchor", () => {
  it("accepts point and element anchors and clamps their numbers", () => {
    expect(sanitizeAnchor({ kind: "point", x: 10.5, y: -3 })).toEqual({ kind: "point", x: 10.5, y: -3 });
    expect(sanitizeAnchor({ kind: "point", x: 1e12, y: -1e12 })).toEqual({ kind: "point", x: 1e7, y: -1e7 });
    expect(sanitizeAnchor({ kind: "element", eid: "box", u: 2, v: -1, x: 5, y: 6 })).toEqual({ kind: "element", eid: "box", u: 1, v: 0, x: 5, y: 6 });
  });

  it("rejects anything that cannot be pinned", () => {
    expect(sanitizeAnchor(null)).toBeNull();
    expect(sanitizeAnchor({ kind: "point", x: Number.NaN, y: 1 })).toBeNull();
    expect(sanitizeAnchor({ kind: "point", x: "1", y: 1 })).toBeNull();
    expect(sanitizeAnchor({ kind: "element", eid: "", u: 0, v: 0, x: 0, y: 0 })).toBeNull();
    expect(sanitizeAnchor({ kind: "element", eid: "x".repeat(81), u: 0, v: 0, x: 0, y: 0 })).toBeNull();
    expect(sanitizeAnchor({ kind: "wat", x: 1, y: 1 })).toBeNull();
  });
});

describe("bodies and snippets", () => {
  it("trims, normalises line endings and caps length", () => {
    expect(cleanBody("  hi\r\nthere \r\n")).toBe("hi\nthere");
    expect(cleanBody("   \n ")).toBe("");
    expect(cleanBody("x".repeat(5000)).length).toBe(2000);
  });

  it("makes one-line snippets", () => {
    expect(snippetOf("a\n\n  b\tc")).toBe("a b c");
    const long = snippetOf("word ".repeat(100));
    expect(long.length).toBeLessThanOrEqual(160);
    expect(long.endsWith("…")).toBe(true);
  });

  it("de-duplicates ids and drops junk", () => {
    expect(uniqueIds(["a", "b", "a", "", "c"])).toEqual(["a", "b", "c"]);
    expect(uniqueIds(Array.from({ length: 100 }, (_, i) => `u${i}`))).toHaveLength(20);
  });
});

describe("unread", () => {
  const t = { lastActivityAt: 1000, lastActivityBy: "someone" };
  it("is unread when never opened, or when others posted after you last opened it", () => {
    expect(isUnread(t, "me", undefined)).toBe(true);
    expect(isUnread(t, "me", 999)).toBe(true);
    expect(isUnread(t, "me", 1000)).toBe(false);
    expect(isUnread(t, "me", 2000)).toBe(false);
  });
  it("never flags your own posts or anonymous visitors", () => {
    expect(isUnread({ ...t, lastActivityBy: "me" }, "me", undefined)).toBe(false);
    expect(isUnread(t, null, undefined)).toBe(false);
  });
});

describe("mentions", () => {
  it("highlights only people who were mentioned, at word boundaries, longest name first", () => {
    const segs = splitMentions("cc @Ada Lovelace and @Adam, not @Bob or mail@Ed.com", [ada, adam, ed]);
    expect(segs.filter((s) => s.mention).map((s) => s.mention!.userId)).toEqual(["u_ada", "u_adam"]);
    expect(segs.map((s) => s.text).join("")).toBe("cc @Ada Lovelace and @Adam, not @Bob or mail@Ed.com");
  });

  it("does not let a short name match the start of a longer word", () => {
    const segs = splitMentions("hi @Adamant", [adam]);
    expect(segs).toEqual([{ text: "hi @Adamant" }]);
  });

  it("works with no mentions or no @", () => {
    expect(splitMentions("plain", [ada])).toEqual([{ text: "plain" }]);
    expect(splitMentions("@Ada Lovelace", [])).toEqual([{ text: "@Ada Lovelace" }]);
  });

  it("finds who is really still mentioned in the text", () => {
    expect(mentionedIn("hello @Ed", [ada, ed]).map((m) => m.userId)).toEqual(["u_ed"]);
    expect(mentionedIn("@Ada Lovelace @Ada Lovelace", [ada]).map((m) => m.userId)).toEqual(["u_ada"]);
    expect(mentionedIn("nobody", [ada, ed])).toEqual([]);
  });

  it("detects the @query under the caret", () => {
    expect(activeMentionQuery("hi @ad", 6)).toEqual({ start: 3, query: "ad" });
    expect(activeMentionQuery("hi @Ada Lov", 11)).toEqual({ start: 3, query: "Ada Lov" });
    expect(activeMentionQuery("hi there", 8)).toBeNull();
    expect(activeMentionQuery("mail@ex", 7)).toBeNull();
    expect(activeMentionQuery("@a\nb", 4)).toBeNull();
    expect(activeMentionQuery("hi @x", 3)).toBeNull(); // caret before the @
  });

  it("searches names by prefix, word prefix, then substring, ignoring case and accents", () => {
    const people = [{ name: "Zoë Zhang" }, { name: "Ada Lovelace" }, { name: "Radha Rao" }, { name: "Lovell" }];
    expect(searchPeople(people, "zoe").map((p) => p.name)).toEqual(["Zoë Zhang"]);
    expect(searchPeople(people, "lov").map((p) => p.name)).toEqual(["Ada Lovelace", "Lovell"]);
    expect(searchPeople(people, "ad").map((p) => p.name)).toEqual(["Ada Lovelace", "Radha Rao"]);
    expect(searchPeople(people, "").length).toBe(4);
    expect(searchPeople(people, "", 2).length).toBe(2);
  });
});
