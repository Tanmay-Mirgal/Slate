import { z } from "zod";
import { ALL_SCOPES, SCOPES } from "../scopes";
import { connectorConfig, CONNECTOR_VERSION, DOCS_URL, LIMITS, PROTOCOL, SERVICE, SERVICE_DISPLAY_NAME, type ConnectorConfig } from "../config";
import type { Registry } from "./define";
import { toJsonSchema } from "./schema";

/**
 * The CP1 manifest, generated from the registry. The Hub renders its workflow forms from `actions[].inputSchema`
 * and learns what it can subscribe to from `events[]`, so nothing here is written by hand.
 */
export function buildManifest(reg: Registry, config: Pick<ConnectorConfig, "baseUrl"> = connectorConfig()) {
  const base = config.baseUrl;
  return {
    protocol: PROTOCOL,
    service: SERVICE,
    displayName: SERVICE_DISPLAY_NAME,
    version: CONNECTOR_VERSION,
    baseUrl: base,
    auth: {
      type: "oauth2_code_pkce" as const,
      authorizeUrl: `${base}/connect/authorize`,
      tokenUrl: `${base}/api/connect/v1/oauth/token`,
      revokeUrl: `${base}/api/connect/v1/oauth/revoke`,
      scopes: ALL_SCOPES.map((name) => ({ name, description: SCOPES[name] })),
    },
    tenantKind: "workspace" as const,
    actions: reg.actions.map((a) => ({
      name: a.name,
      title: a.title,
      description: a.description,
      scopes: [...a.scopes],
      async: a.async,
      idempotent: a.idempotent,
      inputSchema: toJsonSchema(a.input, "input"),
      outputSchema: toJsonSchema(a.output, "output"),
    })),
    resources: reg.resources.map((r) => ({
      name: r.name,
      method: r.method,
      path: r.path,
      scopes: [...r.scopes],
      description: r.description,
      querySchema: toJsonSchema(r.query, "input"),
      outputSchema: toJsonSchema(r.output, "output"),
    })),
    events: reg.events.map((e) => ({
      type: e.type,
      description: e.description,
      scopes: [...e.scopes],
      dataSchema: toJsonSchema(e.data, "output"),
    })),
    limits: { ...LIMITS },
    links: { docs: DOCS_URL, openapi: "/api/connect/v1/openapi.json" },
  };
}

export type Manifest = ReturnType<typeof buildManifest>;

/**
 * What a consumer (the Hub, the conformance tests, the smoke script) checks a manifest against. It describes the
 * document's shape; whether its content matches the running endpoints is what the conformance tests verify.
 */
const jsonSchemaObject = z.record(z.string(), z.unknown());
export const manifestSchema = z.object({
  protocol: z.literal("cp1"),
  service: z.enum(["slate", "orb", "meetup"]),
  displayName: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  baseUrl: z.url(),
  auth: z.object({
    type: z.literal("oauth2_code_pkce"),
    authorizeUrl: z.url(),
    tokenUrl: z.url(),
    revokeUrl: z.url(),
    scopes: z.array(z.object({ name: z.string(), description: z.string() })).min(1),
  }),
  tenantKind: z.enum(["workspace", "organization"]),
  actions: z.array(
    z.object({
      name: z.string().regex(/^[a-z][a-zA-Z]*\.[a-zA-Z]+$/),
      description: z.string(),
      scopes: z.array(z.string()),
      async: z.boolean(),
      idempotent: z.boolean(),
      inputSchema: jsonSchemaObject,
      outputSchema: jsonSchemaObject,
    })
  ),
  resources: z.array(
    z.object({
      name: z.string(),
      method: z.literal("GET"),
      path: z.string().startsWith("/"),
      scopes: z.array(z.string()),
      description: z.string(),
      querySchema: jsonSchemaObject,
      outputSchema: jsonSchemaObject,
    })
  ),
  events: z.array(z.object({ type: z.string().regex(/^[a-z]+(\.[a-z_]+)+$/), description: z.string(), scopes: z.array(z.string()), dataSchema: jsonSchemaObject })),
  limits: z.object({ requestsPerMinute: z.number(), maxBodyBytes: z.number(), webhookMaxEndpoints: z.number() }),
  links: z.object({ docs: z.string(), openapi: z.string() }),
});
