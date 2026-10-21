import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api } from "@/lib/client/api";
import { startRealtimeServer } from "@/lib/realtime/server";
import { as, EDITOR, resetDb, setup, startDb, stopDb } from "./helpers/db";
import { TestSocket } from "./helpers/ws";

// A plain mongod has no change streams: the realtime server must notice and poll instead.
beforeAll(startDb);
afterAll(stopDb);

const verifyToken = async (token: string) => (token.startsWith("test:") ? { userId: token.slice(5) } : null);

describe("without change streams", () => {
  it("'auto' falls back to polling and still pushes everyone's writes", async () => {
    await resetDb();
    const { slateId } = await setup();
    const server = await startRealtimeServer({ port: 0, verifyToken, changeFeed: "auto", pollMs: 30 });
    try {
      expect(server.feed).toBe("poll");
      const sock = await TestSocket.connect(server.port);
      sock.send({ t: "join", slateId, token: `test:${EDITOR.subject}`, since: 0, session: { id: "s1", name: "Ed", color: "#112233" } });
      expect(await sock.take("joined")).toMatchObject({ nudges: false });
      await sock.take("sync");
      await as(EDITOR).mutation(api.elements.apply, {
        slateId,
        ops: [{ t: "put", id: "polled", z: 1, data: JSON.stringify({ id: "polled", type: "shape", shape: "rect", x: 0, y: 0, w: 1, h: 1, z: 1 }) }],
      });
      expect((await sock.take("elements", (m) => m.puts.some((p) => p.eid === "polled"))).puts[0].rev).toBe(1);
      sock.close();
    } finally {
      await server.close();
    }
  });

  it("'stream' refuses to start rather than silently polling", async () => {
    await expect(startRealtimeServer({ port: 0, verifyToken, changeFeed: "stream" })).rejects.toThrow();
  });
});
