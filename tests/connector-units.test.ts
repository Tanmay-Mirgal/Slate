import { describe, expect, it } from "vitest";
import { z } from "zod";
import { assertConnectorEnv, ConnectorConfigError, connectorEnabled, parseConnectorEnv, redirectUriProblem } from "@/lib/connector/config";
import {
  canonicalJson,
  decryptSecret,
  encryptSecret,
  hashToken,
  isValidCodeChallenge,
  newUlid,
  pkceChallenge,
  randomToken,
  safeEqual,
  signWebhookBody,
  usesOldKey,
  verifyPkce,
  verifyWebhookSignature,
} from "@/lib/connector/crypto";
import { err, fromAppError, normalizeError } from "@/lib/connector/errors";
import { parseInput } from "@/lib/connector/http";
import { defineAsyncAction, defineEvent, defineResource, defineSyncAction, matchResource, type Registry } from "@/lib/connector/registry/define";
import { buildManifest, manifestSchema } from "@/lib/connector/registry/manifest";
import { buildOpenApi } from "@/lib/connector/registry/openapi";
import { externalRefSchema } from "@/lib/connector/registry/schema";
import { ALL_SCOPES, parseScopeParam, roleSatisfies, scopesForRole } from "@/lib/connector/scopes";
import { AppError } from "@/lib/server/fn";
import { HUB } from "./helpers/connector";

const goodEnv = {
  CONNECTOR_ENABLED: "true",
  CONNECTOR_HUB_CLIENT_ID: HUB.clientId,
  CONNECTOR_HUB_CLIENT_SECRET: HUB.clientSecret,
  CONNECTOR_HUB_REDIRECT_URIS: HUB.redirectUri,
  CONNECTOR_TOKEN_PEPPER: HUB.pepper,
  CONNECTOR_ENCRYPTION_KEY: HUB.encryptionKey,
};

describe("connector configuration", () => {
  it("is off unless CONNECTOR_ENABLED is exactly true", () => {
    expect(connectorEnabled({})).toBe(false);
    expect(connectorEnabled({ CONNECTOR_ENABLED: "1" })).toBe(false);
    expect(connectorEnabled({ CONNECTOR_ENABLED: "false" })).toBe(false);
    expect(connectorEnabled({ CONNECTOR_ENABLED: "true" })).toBe(true);
    expect(assertConnectorEnv({})).toBeNull();
  });

  it("accepts a complete configuration", () => {
    const parsed = parseConnectorEnv(goodEnv);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.config.hubName).toBe("Hub");
      expect(parsed.config.dispatcher).toBe("inline");
      expect(parsed.config.encryption.current).toHaveLength(32);
    }
  });

  it("lists every problem at once so it can be fixed in one go", () => {
    const parsed = parseConnectorEnv({ CONNECTOR_ENABLED: "true", CONNECTOR_TOKEN_PEPPER: "short", CONNECTOR_ENCRYPTION_KEY: "zz", CONNECTOR_DISPATCHER: "sometimes" });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      const text = parsed.problems.join("\n");
      for (const name of ["CLIENT_ID", "CLIENT_SECRET", "REDIRECT_URIS", "TOKEN_PEPPER", "ENCRYPTION_KEY", "DISPATCHER"]) expect(text).toContain(name);
    }
    expect(() => assertConnectorEnv({ CONNECTOR_ENABLED: "true" })).toThrow(ConnectorConfigError);
  });

  it("rejects a weak pepper made of one repeated character", () => {
    const parsed = parseConnectorEnv({ ...goodEnv, CONNECTOR_TOKEN_PEPPER: "a".repeat(64) });
    expect(parsed.ok).toBe(false);
  });

  it("matches redirect URIs strictly", () => {
    expect(redirectUriProblem("https://hub.example.com/cb", true)).toBeNull();
    expect(redirectUriProblem("http://hub.example.com/cb", false)).not.toBeNull();
    expect(redirectUriProblem("http://localhost:3000/cb", false)).toBeNull();
    expect(redirectUriProblem("http://localhost:3000/cb", true)).not.toBeNull();
    expect(redirectUriProblem("https://hub.example.com/*", true)).toMatch(/wildcard/);
    expect(redirectUriProblem("https://hub.example.com/cb#frag", true)).toMatch(/fragment/);
    expect(redirectUriProblem("javascript:alert(1)", false)).not.toBeNull();
  });
});

describe("token crypto", () => {
  it("makes opaque, prefixed, unique tokens and stores only an HMAC", () => {
    const a = randomToken("cp1_slate_");
    const b = randomToken("cp1_slate_");
    expect(a).not.toBe(b);
    expect(a.startsWith("cp1_slate_")).toBe(true);
    expect(a.length).toBeGreaterThanOrEqual("cp1_slate_".length + 43); // 32 bytes -> 43 base64url characters
    const h = hashToken(a, "pepper-0123456789abcdefghijklmnopqrstuv");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain(a);
    expect(hashToken(a, "another-pepper-0123456789abcdefghijklmnop")).not.toBe(h);
  });

  it("compares in constant time and handles different lengths", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
  });
});

describe("PKCE (RFC 7636)", () => {
  // the worked example from appendix B of the RFC
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  const challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

  it("derives the S256 challenge", () => {
    expect(pkceChallenge(verifier)).toBe(challenge);
    expect(isValidCodeChallenge(challenge)).toBe(true);
  });

  it("verifies the right verifier and nothing else", () => {
    expect(verifyPkce(verifier, challenge)).toBe(true);
    expect(verifyPkce(verifier.slice(0, -1) + "A", challenge)).toBe(false);
    expect(verifyPkce("too-short", pkceChallenge("too-short"))).toBe(false); // verifiers need 43+ characters
    expect(verifyPkce(verifier + "!", challenge)).toBe(false);
  });
});

describe("AES-256-GCM secrets", () => {
  const keys = { current: Buffer.alloc(32, 1) };

  it("round-trips and never stores the plaintext", () => {
    const enc = encryptSecret("whsec_abc", "hook1", keys);
    expect(enc.startsWith("enc:v1:")).toBe(true);
    expect(enc).not.toContain("whsec_abc");
    expect(decryptSecret(enc, "hook1", keys)).toBe("whsec_abc");
    expect(encryptSecret("whsec_abc", "hook1", keys)).not.toBe(enc); // fresh IV every time
  });

  it("is bound to its row and detects tampering", () => {
    const enc = encryptSecret("whsec_abc", "hook1", keys);
    expect(() => decryptSecret(enc, "hook2", keys)).toThrow();
    const parts = enc.split(":");
    parts[5] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptSecret(parts.join(":"), "hook1", keys)).toThrow();
  });

  it("survives key rotation: old ciphertext is read with the previous key and flagged for re-encryption", () => {
    const oldKeys = { current: Buffer.alloc(32, 7) };
    const enc = encryptSecret("whsec_old", "hook1", oldKeys);
    const rotated = { current: Buffer.alloc(32, 9), previous: oldKeys.current };
    expect(decryptSecret(enc, "hook1", rotated)).toBe("whsec_old");
    expect(usesOldKey(enc, rotated)).toBe(true);
    expect(usesOldKey(encryptSecret("x", "hook1", rotated), rotated)).toBe(false);
    expect(() => decryptSecret(enc, "hook1", { current: Buffer.alloc(32, 9) })).toThrow(/no longer configured/);
  });
});

describe("webhook signatures", () => {
  const secret = "whsec_test";
  const body = '{"id":"evt_1","type":"board.approved"}';
  const ts = 1_760_000_000;

  it("signs as v1=hex(HMAC(secret, timestamp.body)) and verifies", () => {
    const sig = signWebhookBody(secret, ts, body);
    expect(sig).toMatch(/^v1=[0-9a-f]{64}$/);
    expect(verifyWebhookSignature(secret, ts, body, sig, { nowSeconds: ts + 10 })).toBe(true);
  });

  it("rejects a changed body, another secret, another timestamp and a stale request", () => {
    const sig = signWebhookBody(secret, ts, body);
    expect(verifyWebhookSignature(secret, ts, body + " ", sig, { nowSeconds: ts })).toBe(false);
    expect(verifyWebhookSignature("whsec_other", ts, body, sig, { nowSeconds: ts })).toBe(false);
    expect(verifyWebhookSignature(secret, ts + 1, body, sig, { nowSeconds: ts })).toBe(false);
    expect(verifyWebhookSignature(secret, ts, body, sig, { nowSeconds: ts + 301 })).toBe(false);
  });
});

describe("ULIDs", () => {
  it("are 26 Crockford characters that sort in creation order, even within one millisecond", () => {
    const ids = Array.from({ length: 500 }, () => newUlid(1_700_000_000_000));
    for (const id of ids) expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
    expect(newUlid(1_700_000_001_000) > ids[ids.length - 1]).toBe(true);
  });
});

describe("canonical JSON", () => {
  it("ignores key order and whitespace but not values", () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { y: 1, x: 2 }], c: null } })).toBe(canonicalJson(JSON.parse('{ "a": {"c": null, "d": [1, {"x":2,"y":1}]}, "b": 1 }')));
    expect(canonicalJson({ a: 1 })).not.toBe(canonicalJson({ a: 2 }));
    expect(canonicalJson({ a: undefined, b: 1 })).toBe(canonicalJson({ b: 1 }));
  });
});

describe("scopes and roles", () => {
  it("lets Admins and Editors use every scope and Viewers everything except writing", () => {
    expect(scopesForRole("Admin")).toEqual(ALL_SCOPES);
    expect(scopesForRole("Editor")).toEqual(ALL_SCOPES);
    expect(scopesForRole("Viewer")).not.toContain("slate:boards:write");
    expect(scopesForRole("Viewer")).toContain("slate:boards:read");
    expect(roleSatisfies("Viewer", ["slate:boards:read"])).toBe(true);
    expect(roleSatisfies("Viewer", ["slate:boards:read", "slate:boards:write"])).toBe(false);
  });

  it("parses the scope parameter, reporting unknown names and pairing webhooks with the event log", () => {
    expect(parseScopeParam("slate:boards:read  slate:boards:read nope")).toEqual({ scopes: ["slate:boards:read"], unknown: ["nope"] });
    expect(parseScopeParam("slate:webhooks:manage").scopes).toEqual(["slate:events:read", "slate:webhooks:manage"]);
    expect(parseScopeParam(null)).toEqual({ scopes: [], unknown: [] });
  });
});

describe("error model", () => {
  it("gives every code its CP1 status and flags only transient ones as retryable", () => {
    expect(err.unauthorized().status).toBe(401);
    expect(err.insufficientScope("slate:boards:write").status).toBe(403);
    expect(err.insufficientScope("slate:boards:write").extra).toEqual({ requiredScope: "slate:boards:write" });
    expect(err.notFound().status).toBe(404);
    expect(err.validation("x").status).toBe(400);
    expect(err.conflict("x").status).toBe(409);
    expect(err.idempotencyConflict().status).toBe(422);
    expect(err.planLimit("x").status).toBe(402);
    expect(err.precondition("x").status).toBe(412);
    expect(err.rateLimited(3).headers["Retry-After"]).toBe("3");
    for (const e of [err.rateLimited(1), err.upstream(), err.unavailable(), err.internal()]) expect(e.retryable).toBe(true);
    for (const e of [err.unauthorized(), err.forbidden(), err.notFound(), err.validation("x"), err.planLimit("x"), err.conflict("x")]) expect(e.retryable).toBe(false);
  });

  it("maps what the app throws and never leaks unexpected failures", () => {
    expect(fromAppError(new AppError("Slate not found")).code).toBe("not_found");
    expect(fromAppError(new AppError("You don't have access to this slate")).code).toBe("not_found");
    expect(fromAppError(new AppError("You only have view access to this slate")).code).toBe("forbidden");
    expect(fromAppError(new AppError("Element is too large")).status).toBe(422);
    const limit = fromAppError(new AppError("The Free plan includes 3 boards", { code: "board_limit", message: "The Free plan includes 3 boards", tier: "free", limit: 3 }));
    expect(limit.code).toBe("plan_limit");
    expect(limit.extra).toMatchObject({ limit: 3, tier: "free", reason: "board_limit" });
    expect(normalizeError(new Error("mongo://user:password@host exploded")).message).not.toContain("password");
    expect(normalizeError(new Error("boom")).code).toBe("internal");
    const zodErr = z.object({ title: z.string() }).safeParse({});
    if (!zodErr.success) expect(normalizeError(zodErr.error).details).toEqual([{ path: "title", message: expect.any(String) }]);
  });
});

describe("strict input parsing", () => {
  const schema = z.strictObject({ title: z.string().min(1), n: z.number().default(3), nested: z.strictObject({ a: z.number() }).optional() });

  it("rejects unknown fields with their path", () => {
    expect(() => parseInput(schema, { title: "x", extra: 1 }, false)).toThrow(/not valid/);
    try {
      parseInput(schema, { title: "x", nested: { a: 1, zzz: 2 } }, false);
    } catch (e) {
      expect(normalizeErrorDetails(e)).toContainEqual({ path: "nested", message: expect.stringContaining("zzz") });
    }
  });

  it("drops unknown fields (also nested ones) when asked to, and still validates the rest", () => {
    expect(parseInput(schema, { title: "x", extra: 1, nested: { a: 1, zzz: 2 } }, true)).toEqual({ title: "x", n: 3, nested: { a: 1 } });
    expect(() => parseInput(schema, { title: "", extra: 1 }, true)).toThrow();
  });
});

function normalizeErrorDetails(e: unknown) {
  return (e as { details?: unknown }).details;
}

describe("registry -> manifest / OpenAPI", () => {
  const create = defineSyncAction({
    name: "boards.create",
    title: "Create a board",
    description: "Creates a board.",
    scopes: ["slate:boards:write"],
    input: z.strictObject({
      title: z.string().min(1).max(120).meta({ title: "Title", description: "Board title", examples: ["Order platform"] }),
      kind: z.enum(["auto", "architecture"]).default("auto").describe("Diagram kind"),
      externalRef: externalRefSchema.optional(),
    }),
    output: z.object({ board: z.object({ id: z.string(), webUrl: z.string() }) }),
    handler: async () => ({ board: { id: "1", webUrl: "https://slate.test/canvas/1" } }),
  });
  const gen = defineAsyncAction({
    name: "boards.generateDiagram",
    title: "Generate",
    description: "Generates.",
    scopes: ["slate:ai:generate", "slate:boards:write"],
    input: z.strictObject({ prompt: z.string().max(2000) }),
    output: z.object({ dsl: z.string() }),
    accept: async () => ({ state: {} }),
    run: async () => ({ dsl: "x" }),
  });
  const list = defineResource({
    name: "boards.get",
    path: "/boards/{id}",
    scopes: ["slate:boards:read"],
    description: "One board",
    query: z.object({}),
    output: z.object({ id: z.string() }),
    handler: async (c) => ({ id: c.params.id }),
  });
  const approved = defineEvent({ type: "board.approved", description: "A board was approved", scopes: ["slate:boards:read"], data: z.object({ board: z.object({ id: z.string() }) }) });
  const reg: Registry = { actions: [create, gen], resources: [list], events: [approved] };
  const manifest = buildManifest(reg, { baseUrl: "https://slate.test" });

  it("produces a manifest that satisfies the CP1 shape", () => {
    expect(manifestSchema.safeParse(manifest).success).toBe(true);
    expect(manifest.protocol).toBe("cp1");
    expect(manifest.service).toBe("slate");
    expect(manifest.auth.authorizeUrl).toBe("https://slate.test/connect/authorize");
    expect(manifest.auth.scopes.map((s) => s.name)).toEqual(ALL_SCOPES);
    expect(manifest.limits).toEqual({ requestsPerMinute: 120, maxBodyBytes: 1048576, webhookMaxEndpoints: 5 });
  });

  it("derives JSON Schema 2020-12 that carries what the Hub's forms need", () => {
    const input = manifest.actions[0].inputSchema as { type: string; additionalProperties: boolean; required: string[]; properties: Record<string, Record<string, unknown>> };
    expect(input.type).toBe("object");
    expect(input.additionalProperties).toBe(false);
    expect(input.required).toEqual(["title"]); // kind has a default, so it is optional to send
    expect(input.properties.title).toMatchObject({ title: "Title", description: "Board title", minLength: 1, maxLength: 120, examples: ["Order platform"] });
    expect(input.properties.kind).toMatchObject({ enum: ["auto", "architecture"], default: "auto", description: "Diagram kind" });
    expect(input.properties.externalRef).toMatchObject({ title: "External reference" });
    expect(JSON.stringify(manifest)).not.toContain("$schema");
  });

  it("flags async actions and lists the scopes each one needs", () => {
    expect(manifest.actions.map((a) => [a.name, a.async, a.scopes])).toEqual([
      ["boards.create", false, ["slate:boards:write"]],
      ["boards.generateDiagram", true, ["slate:ai:generate", "slate:boards:write"]],
    ]);
    expect(manifest.events[0]).toMatchObject({ type: "board.approved", scopes: ["slate:boards:read"] });
  });

  it("is generated from the same declarations as the OpenAPI document", () => {
    const api = buildOpenApi(reg, { baseUrl: "https://slate.test" }) as unknown as { openapi: string; paths: Record<string, Record<string, { responses: Record<string, unknown> }>> };
    expect(api.openapi).toBe("3.1.0");
    expect(Object.keys(api.paths["/actions/boards.create"])).toEqual(["post"]);
    expect(api.paths["/actions/boards.create"].post.responses["200"]).toBeDefined();
    expect(api.paths["/actions/boards.generateDiagram"].post.responses["202"]).toBeDefined();
    expect(api.paths["/boards/{id}"].get).toBeDefined();
    for (const p of ["/health", "/me", "/oauth/token", "/oauth/revoke", "/webhooks", "/events", "/operations/{id}", "/manifest", "/openapi.json"]) expect(api.paths[p]).toBeDefined();
  });

  it("routes resource paths with parameters", () => {
    expect(matchResource(reg.resources, "/boards/abc")?.params).toEqual({ id: "abc" });
    expect(matchResource(reg.resources, "/boards/abc/")?.params).toEqual({ id: "abc" });
    expect(matchResource(reg.resources, "/boards")).toBeNull();
    expect(matchResource(reg.resources, "/boards/a/b")).toBeNull();
    expect(matchResource(reg.resources, "/boards/a%20b")?.params).toEqual({ id: "a b" });
  });
});
