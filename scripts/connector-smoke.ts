/**
 * End-to-end smoke test of the ecosystem connector against a RUNNING Slate instance.
 *
 *   npm run connector:smoke -- --user user_2abc --workspace 665f... [--base http://localhost:3000] [--webhook]
 *   npm run connector:smoke -- --token cp1_slate_...               [--base https://slate.example.com]
 *
 * With --user / --workspace it mints a grant straight in the database (same MONGODB_URI and CONNECTOR_* settings as the
 * running app; refused when NODE_ENV=production) so no browser consent is needed. With --token it uses a token you got
 * from the real OAuth flow. It creates a board, drives it through import, document, export, review, approval and
 * archive, polls the event log, and (with --webhook) receives and verifies a signed delivery on a local port; for
 * that the app must run in development mode (`npm run dev`) with CONNECTOR_ALLOW_PRIVATE_WEBHOOKS=true and a
 * dispatcher running. Webhook URLs on localhost are always refused in production.
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { connectorConfig } from "@/lib/connector/config";
import { verifyWebhookSignature } from "@/lib/connector/crypto";
import { mintGrant, revokeGrant } from "@/lib/connector/oauth/grants";
import { manifestSchema } from "@/lib/connector/registry/manifest";
import { ALL_SCOPES } from "@/lib/connector/scopes";
import { closeMongo } from "@/lib/db/mongo";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const argv = process.argv.slice(2);
const opt = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const flag = (name: string) => argv.includes(`--${name}`);

const base = (opt("base") ?? process.env.CONNECTOR_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const api = `${base}/api/connect/v1`;
let token = opt("token") ?? "";
let grantId: string | null = null;

const results: { name: string; ok: boolean; note: string }[] = [];
async function step(name: string, fn: () => Promise<string | void>) {
  try {
    results.push({ name, ok: true, note: (await fn()) ?? "" });
  } catch (e) {
    results.push({ name, ok: false, note: e instanceof Error ? e.message : String(e) });
  }
}
function expect(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${api}${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json: Json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    /* not JSON */
  }
  return { status: res.status, json, headers: res.headers, text };
}
const action = (name: string, input: unknown, headers?: Record<string, string>) => call("POST", `/actions/${name}`, { input }, headers);

async function main() {
  if (!token) {
    const user = opt("user");
    const workspace = opt("workspace");
    if (!user || !workspace) throw new Error("Pass --token, or --user and --workspace to mint a grant in the database.");
    if (process.env.NODE_ENV === "production") throw new Error("Refusing to mint a grant directly in a production database. Use --token from the real OAuth flow.");
    const minted = await mintGrant({ clientId: connectorConfig().clientId, userId: user, workspaceId: workspace, scopes: ALL_SCOPES });
    token = minted.tokens.accessToken;
    grantId = minted.grant._id;
  }

  let boardId = "";
  let hook: { secret: string; id: string } | null = null;
  const deliveries: { headers: Record<string, string | string[] | undefined>; body: string }[] = [];

  await step("health (no auth)", async () => {
    const r = await fetch(`${api}/health`);
    expect(r.status === 200, `status ${r.status}`);
  });
  await step("manifest is valid and cacheable", async () => {
    const r = await fetch(`${base}/.well-known/ecosystem-connector.json`);
    expect(r.status === 200, `status ${r.status}`);
    const parsed = manifestSchema.safeParse(await r.json());
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues[0]));
    return `${parsed.data.actions.length} actions, ${parsed.data.resources.length} resources, ${parsed.data.events.length} events`;
  });
  await step("me", async () => {
    const r = await call("GET", "/me");
    expect(r.status === 200, `status ${r.status} ${r.text.slice(0, 120)}`);
    return `${r.json.user.email} as ${r.json.tenant.role} in "${r.json.tenant.name}"`;
  });

  if (flag("webhook")) {
    await step("register a webhook on a local receiver", async () => {
      const server = createServer((rq, rs) => {
        const chunks: Buffer[] = [];
        rq.on("data", (d) => chunks.push(d));
        rq.on("end", () => {
          deliveries.push({ headers: rq.headers, body: Buffer.concat(chunks).toString("utf8") });
          rs.end("ok");
        });
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      process.once("exit", () => server.close());
      const r = await call("POST", "/webhooks", { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`, events: ["board.*"] });
      expect(r.status === 201, `status ${r.status} ${r.text.slice(0, 160)} (--webhook needs an app in development mode with CONNECTOR_ALLOW_PRIVATE_WEBHOOKS=true: a production app, rightly, refuses a localhost receiver)`);
      hook = { secret: r.json.secret, id: r.json.id };
    });
  }

  await step("boards.create (idempotent)", async () => {
    const key = `smoke-${Date.now()}`;
    const input = { title: "Connector smoke test", externalRef: { hubRunId: "smoke" }, metadata: { smoke: true } };
    const a = await action("boards.create", input, { "idempotency-key": key });
    const b = await action("boards.create", input, { "idempotency-key": key });
    expect(a.status === 200, `status ${a.status} ${a.text.slice(0, 160)}`);
    expect(b.headers.get("idempotent-replay") === "true" && b.json.output.board.id === a.json.output.board.id, "the repeated request was not replayed");
    boardId = a.json.output.board.id;
    return a.json.output.board.webUrl;
  });
  await step("boards.importDsl", async () => {
    const r = await action("boards.importDsl", { boardId, dsl: "title Smoke\ntype architecture\nWeb\nAPI\nDB\nWeb > API : HTTPS\nAPI > DB : SQL\n" });
    expect(r.status === 200, `status ${r.status} ${r.text.slice(0, 160)}`);
    return `${r.json.output.diagram.nodes} nodes`;
  });
  await step("boards.setDocument", async () => {
    const r = await action("boards.setDocument", { boardId, markdown: "# Smoke test\n\nWritten by the connector." });
    expect(r.status === 200, `status ${r.status}`);
  });
  await step("resources: board, dsl, graph, document", async () => {
    for (const p of ["", "/dsl", "/graph", "/document"]) expect((await call("GET", `/boards/${boardId}${p}`)).status === 200, `GET /boards/{id}${p}`);
  });
  await step("boards.export markdown + svg", async () => {
    const md = await action("boards.export", { boardId, format: "markdown" });
    const svg = await action("boards.export", { boardId, format: "svg" });
    expect(md.status === 200 && md.json.output.content.includes("mermaid"), `markdown ${md.status}`);
    expect(svg.status === 200, `svg ${svg.status}`);
  });
  await step("analysis: review, cost, resilience", async () => {
    for (const a of ["boards.review", "boards.estimateCost", "boards.analyzeResilience"]) expect((await action(a, { boardId })).status === 200, a);
  });
  await step("boards.setStatus approved", async () => {
    const r = await action("boards.setStatus", { boardId, status: "approved", note: "smoke" });
    expect(r.status === 200 && r.json.output.board.status === "approved", `status ${r.status} ${r.text.slice(0, 160)}`);
  });
  await step("GET /events replays board.approved", async () => {
    const r = await call("GET", "/events?types=board.approved");
    expect(r.status === 200, `status ${r.status}`);
    expect(r.json.items.some((e: Json) => e.data?.board?.id === boardId), "board.approved not in the event log");
  });

  if (hook) {
    const registered: { secret: string; id: string } = hook;
    await step("webhook: signed board.approved arrives", async () => {
      const deadline = Date.now() + 25_000;
      while (Date.now() < deadline && !deliveries.some((d) => JSON.parse(d.body).type === "board.approved")) await new Promise((r) => setTimeout(r, 500));
      const d = deliveries.find((x) => JSON.parse(x.body).type === "board.approved");
      expect(d, "no delivery within 25 s (is a dispatcher running?)");
      const ts = Number(d.headers["x-cp-timestamp"]);
      expect(verifyWebhookSignature(registered.secret, ts, d.body, String(d.headers["x-cp-signature"])), "signature did not verify");
      return `${deliveries.length} deliveries, signature ok`;
    });
    await call("DELETE", `/webhooks/${registered.id}`);
  }

  await step("boards.archive", async () => {
    const r = await action("boards.archive", { boardId });
    expect(r.status === 200, `status ${r.status}`);
    expect((await call("GET", `/boards/${boardId}`)).status === 404, "an archived board should be 404");
  });
  await step("a foreign id is a 404, not a 403", async () => {
    expect((await call("GET", "/boards/000000000000000000000000")).status === 404, "expected 404");
  });
  if (grantId) {
    await step("revoking blocks the very next call", async () => {
      await revokeGrant(grantId!, "smoke_test");
      expect((await call("GET", "/me")).status === 401, "expected 401 after revoke");
    });
  }
}

main()
  .catch((e) => results.push({ name: "setup", ok: false, note: e instanceof Error ? e.message : String(e) }))
  .finally(async () => {
    for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.note ? `  (${r.note})` : ""}`);
    const failed = results.filter((r) => !r.ok).length;
    console.log(failed === 0 ? `\nAll ${results.length} checks passed.` : `\n${failed} of ${results.length} checks failed.`);
    await closeMongo().catch(() => undefined);
    process.exit(failed === 0 ? 0 : 1);
  });
