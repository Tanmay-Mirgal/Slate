import { ALL_SCOPES, SCOPES } from "../scopes";
import { connectorConfig, CONNECTOR_VERSION, type ConnectorConfig } from "../config";
import type { Registry } from "./define";
import { toJsonSchema, type JsonSchema } from "./schema";
import { operationSchema, STANDARD_ENDPOINTS } from "./standard";

type Json = Record<string, unknown>;

const errorSchema: JsonSchema = {
  type: "object",
  required: ["error"],
  properties: {
    error: {
      type: "object",
      required: ["code", "message", "retryable", "requestId"],
      properties: {
        code: {
          type: "string",
          enum: ["unauthorized", "insufficient_scope", "forbidden", "not_found", "validation_failed", "conflict", "idempotency_conflict", "plan_limit", "precondition_failed", "rate_limited", "upstream_failed", "unavailable", "internal"],
        },
        message: { type: "string" },
        details: { type: "array", items: { type: "object", required: ["path", "message"], properties: { path: { type: "string" }, message: { type: "string" } } } },
        retryable: { type: "boolean" },
        requestId: { type: "string" },
      },
      additionalProperties: true,
    },
  },
};

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const errorResponses = (): Json => ({
  "400": { description: "validation_failed", content: { "application/json": { schema: ref("Error") } } },
  "401": { description: "unauthorized", content: { "application/json": { schema: ref("Error") } } },
  "403": { description: "insufficient_scope or forbidden", content: { "application/json": { schema: ref("Error") } } },
  "404": { description: "not_found (also for ids that belong to another workspace)", content: { "application/json": { schema: ref("Error") } } },
  "429": { description: "rate_limited", headers: { "Retry-After": { schema: { type: "integer" } } }, content: { "application/json": { schema: ref("Error") } } },
});

const rateHeaders: Json = {
  "X-RateLimit-Limit": { schema: { type: "integer" } },
  "X-RateLimit-Remaining": { schema: { type: "integer" } },
  "X-RateLimit-Reset": { schema: { type: "integer" }, description: "Unix seconds" },
  "X-Request-Id": { schema: { type: "string" } },
};

const json = (schema: JsonSchema) => ({ "application/json": { schema } });
const pathParams = (path: string) =>
  [...path.matchAll(/\{(\w+)\}/g)].map((m) => ({ name: m[1], in: "path", required: true, schema: { type: "string" } }));

/** OpenAPI 3.1 (which uses JSON Schema 2020-12 as is), generated from the same registry as the manifest. */
export function buildOpenApi(reg: Registry, config: Pick<ConnectorConfig, "baseUrl"> = connectorConfig()) {
  const base = config.baseUrl;
  const paths: Record<string, Json> = {};
  const add = (path: string, method: string, op: Json) => {
    paths[path] = { ...(paths[path] ?? {}), [method]: op };
  };

  for (const e of STANDARD_ENDPOINTS) {
    const okStatus = String(e.status ?? 200);
    const op: Json = {
      summary: e.summary,
      tags: ["standard"],
      parameters: [
        ...pathParams(e.path),
        ...Object.entries(e.query ?? {}).map(([name, description]) => ({ name, in: "query", required: false, description, schema: { type: "string" } })),
      ],
      ...(e.auth === "token" ? { security: [{ bearer: [...(e.scopes ?? [])] }] } : e.auth === "client" ? { security: [{ clientAuth: [] }] } : { security: [] }),
      ...(e.requestBody
        ? { requestBody: { required: true, content: { "application/json": { schema: toJsonSchema(e.requestBody, "input") }, ...(e.form ? { "application/x-www-form-urlencoded": { schema: toJsonSchema(e.requestBody, "input") } } : {}) } } }
        : {}),
      responses: {
        [okStatus]: { description: "OK", ...(e.response ? { content: json(toJsonSchema(e.response, "output")) } : {}), ...(e.auth === "token" ? { headers: rateHeaders } : {}) },
        ...(e.auth === "token" ? errorResponses() : {}),
      },
    };
    add(e.path, e.method, op);
  }

  for (const a of reg.actions) {
    add(`/actions/${a.name}`, "post", {
      summary: a.title,
      description: a.description,
      tags: ["actions"],
      operationId: a.name,
      security: [{ bearer: [...a.scopes] }],
      parameters: [{ name: "Idempotency-Key", in: "header", required: false, schema: { type: "string", maxLength: 128 } }],
      requestBody: { required: true, content: json({ type: "object", required: ["input"], additionalProperties: false, properties: { input: toJsonSchema(a.input, "input") } }) },
      responses: {
        ...(a.async
          ? { "202": { description: "Accepted. Poll the operation until it reaches a terminal state.", headers: rateHeaders, content: json({ type: "object", required: ["operation"], properties: { operation: { ...toJsonSchema(operationSchema, "output"), description: "pollUrl is relative to the API base" } } }) } }
          : { "200": { description: "Done", headers: rateHeaders, content: json({ type: "object", required: ["output"], properties: { output: toJsonSchema(a.output, "output") } }) } }),
        "402": { description: "plan_limit (board cap or AI credits)", content: json(ref("Error")) },
        "422": { description: "idempotency_conflict", content: json(ref("Error")) },
        ...errorResponses(),
      },
    });
  }

  for (const r of reg.resources) {
    const query = toJsonSchema(r.query, "input") as { properties?: Record<string, JsonSchema>; required?: string[] };
    add(r.path, "get", {
      summary: r.description,
      tags: ["resources"],
      operationId: r.name,
      security: [{ bearer: [...r.scopes] }],
      parameters: [
        ...pathParams(r.path),
        ...Object.entries(query.properties ?? {}).map(([name, schema]) => ({ name, in: "query", required: (query.required ?? []).includes(name), schema })),
      ],
      responses: { "200": { description: "OK", headers: rateHeaders, content: json(toJsonSchema(r.output, "output")) }, ...errorResponses() },
    });
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "Slate Connector API",
      version: CONNECTOR_VERSION,
      description: "Ecosystem Connector Protocol v1 (CP1) for Slate. Authenticate with OAuth 2.0 authorization code + PKCE; every request acts as the user who connected, inside one workspace.",
    },
    servers: [{ url: `${base}/api/connect/v1` }],
    tags: [{ name: "standard" }, { name: "actions" }, { name: "resources" }],
    paths,
    components: {
      securitySchemes: {
        bearer: { type: "http", scheme: "bearer", description: "Access token (cp1_slate_...) from /oauth/token" },
        clientAuth: { type: "http", scheme: "basic", description: "The Hub's client id and secret (or send them in the body)" },
        oauth2: {
          type: "oauth2",
          flows: {
            authorizationCode: {
              authorizationUrl: `${base}/connect/authorize`,
              tokenUrl: `${base}/api/connect/v1/oauth/token`,
              refreshUrl: `${base}/api/connect/v1/oauth/token`,
              scopes: Object.fromEntries(ALL_SCOPES.map((s) => [s, SCOPES[s]])),
            },
          },
        },
      },
      schemas: { Error: errorSchema },
    },
  } as const;
}

export type OpenApiDocument = ReturnType<typeof buildOpenApi>;
