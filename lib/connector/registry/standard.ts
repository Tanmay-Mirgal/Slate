import { z } from "zod";
import { SCOPES } from "../scopes";
import { externalRefSchema, pageOf } from "./schema";

/**
 * The endpoints every CP1 service has, independent of what the service can do. They are described here with
 * zod so the OpenAPI document is generated rather than written by hand.
 */

const iso = z.string().meta({ description: "ISO-8601 UTC timestamp", examples: ["2026-01-01T10:00:00.000Z"] });

export const healthSchema = z.object({ status: z.literal("ok"), version: z.string(), time: iso });

export const meSchema = z.object({
  user: z.object({ id: z.string(), email: z.string(), name: z.string() }),
  tenant: z.object({ id: z.string(), name: z.string(), kind: z.literal("workspace"), role: z.enum(["Admin", "Editor", "Viewer"]) }),
  scopes: z.array(z.string()).describe("Scopes this connection can use right now (granted scopes narrowed by the user's role)"),
  grantId: z.string(),
  plan: z.object({
    name: z.string(),
    limits: z.object({ maxBoards: z.number().nullable(), aiCreditsMonthly: z.number() }),
    usage: z.object({ boards: z.number().nullable(), aiCredits: z.number() }),
  }),
  capabilities: z.object({
    aiAvailable: z.boolean(),
    aiCreditsRemaining: z.number(),
    boardsUsed: z.number().nullable(),
    boardsCap: z.number().nullable(),
  }),
});

export const operationSchema = z.object({
  id: z.string(),
  action: z.string(),
  status: z.enum(["pending", "running", "succeeded", "failed", "canceled"]),
  output: z.record(z.string(), z.unknown()).optional(),
  error: z.object({ code: z.string(), message: z.string(), retryable: z.boolean() }).optional(),
  createdAt: iso,
  finishedAt: iso.optional(),
});

export const webhookSchema = z.object({
  id: z.string(),
  url: z.string(),
  events: z.array(z.string()),
  description: z.string().optional(),
  status: z.enum(["active", "disabled"]),
  disabledReason: z.string().optional(),
  createdAt: iso,
  lastDeliveryAt: iso.optional(),
  lastDeliveryStatus: z.enum(["succeeded", "failed"]).optional(),
});

export const webhookInputSchema = z.strictObject({
  url: z.url().max(2048).meta({ title: "Endpoint URL", description: "https URL that receives the events. Private and internal addresses are rejected." }),
  events: z
    .array(z.string().min(1).max(64))
    .min(1)
    .max(40)
    .meta({ title: "Events", description: "Event types or prefix patterns, e.g. board.approved or board.*", examples: [["board.*"]] }),
  description: z.string().max(200).optional(),
});

export const webhookPatchSchema = z.strictObject({
  url: webhookInputSchema.shape.url.optional(),
  events: webhookInputSchema.shape.events.optional(),
  description: z.string().max(200).optional(),
  status: z.enum(["active", "disabled"]).optional().describe("Set to active to re-enable a disabled endpoint"),
});

export const deliverySchema = z.object({
  id: z.string(),
  eventId: z.string(),
  eventType: z.string(),
  status: z.enum(["pending", "succeeded", "failed"]),
  attempts: z.number(),
  nextAttemptAt: iso.optional(),
  lastStatusCode: z.number().optional(),
  lastBody: z.string().optional().describe("Truncated response body of the last attempt"),
  lastError: z.string().optional(),
  createdAt: iso,
});

export const eventSchema = z.object({
  id: z.string().describe("evt_<ULID>; consumers de-duplicate on it"),
  type: z.string(),
  apiVersion: z.literal("cp1"),
  service: z.literal("slate"),
  occurredAt: iso,
  tenantId: z.string(),
  actor: z.object({ id: z.string(), name: z.string(), kind: z.enum(["user", "system", "connector"]) }),
  externalRef: externalRefSchema.optional(),
  data: z.record(z.string(), z.unknown()),
});

export const tokenRequestSchema = z.object({
  grant_type: z.enum(["authorization_code", "refresh_token"]),
  code: z.string().optional(),
  redirect_uri: z.string().optional(),
  code_verifier: z.string().optional(),
  refresh_token: z.string().optional(),
  client_id: z.string().optional(),
  client_secret: z.string().optional(),
});

export const tokenResponseSchema = z.object({
  token_type: z.literal("Bearer"),
  access_token: z.string(),
  expires_in: z.number(),
  refresh_token: z.string(),
  scope: z.string(),
  tenant: z.object({ id: z.string(), name: z.string(), kind: z.literal("workspace") }),
  user: z.object({ id: z.string(), email: z.string(), name: z.string() }),
});

export interface StandardEndpoint {
  method: "get" | "post" | "patch" | "delete";
  /** Relative to /api/connect/v1. */
  path: string;
  summary: string;
  auth: "none" | "token" | "client";
  scopes?: readonly string[];
  requestBody?: z.ZodType;
  /** application/x-www-form-urlencoded is accepted as well as JSON. */
  form?: boolean;
  status?: number;
  response?: z.ZodType;
  query?: Record<string, string>;
}

const events = ["slate:events:read"] as const;
const hooks = ["slate:webhooks:manage"] as const;

export const STANDARD_ENDPOINTS: readonly StandardEndpoint[] = [
  { method: "get", path: "/manifest", summary: "Machine-readable description of this service (same document as /.well-known/ecosystem-connector.json)", auth: "none" },
  { method: "get", path: "/openapi.json", summary: "This OpenAPI 3.1 document", auth: "none" },
  { method: "get", path: "/health", summary: "Liveness check. No tenant data, no secrets.", auth: "none", response: healthSchema },
  { method: "post", path: "/oauth/token", summary: "Exchange an authorization code or a refresh token for tokens (RFC 6749)", auth: "client", requestBody: tokenRequestSchema, form: true, response: tokenResponseSchema },
  { method: "post", path: "/oauth/revoke", summary: "Revoke an access or refresh token (RFC 7009). Always answers 200.", auth: "client", form: true },
  { method: "get", path: "/me", summary: "Who the connection acts as, its scopes, the plan and what the service can do", auth: "token", response: meSchema },
  { method: "get", path: "/operations/{id}", summary: "State of an asynchronous action. Operations are kept for 7 days and belong to the connection that started them.", auth: "token", response: operationSchema },
  { method: "post", path: "/webhooks", summary: "Register a webhook endpoint. The signing secret is returned once.", auth: "token", scopes: hooks, requestBody: webhookInputSchema, status: 201, response: webhookSchema.extend({ secret: z.string().describe("whsec_...; shown only in this response") }) },
  { method: "get", path: "/webhooks", summary: "List this connection's webhook endpoints", auth: "token", scopes: hooks, response: pageOf(webhookSchema) },
  { method: "get", path: "/webhooks/{id}", summary: "One webhook endpoint (status, disabled reason, last delivery)", auth: "token", scopes: hooks, response: webhookSchema },
  { method: "patch", path: "/webhooks/{id}", summary: "Change an endpoint or re-enable it", auth: "token", scopes: hooks, requestBody: webhookPatchSchema, response: webhookSchema },
  { method: "delete", path: "/webhooks/{id}", summary: "Delete an endpoint", auth: "token", scopes: hooks, status: 204 },
  { method: "get", path: "/webhooks/{id}/deliveries", summary: "Delivery log of an endpoint", auth: "token", scopes: hooks, response: pageOf(deliverySchema) },
  { method: "post", path: "/webhooks/{id}/deliveries/{deliveryId}/redeliver", summary: "Send a delivery again, right now", auth: "token", scopes: hooks, response: deliverySchema },
  { method: "get", path: "/events", summary: "The workspace's event log in order (polling fallback; kept 7 days)", auth: "token", scopes: events, response: pageOf(eventSchema), query: { cursor: "Opaque cursor from the previous page", types: "Comma separated event types or prefix patterns", limit: "Page size, max 200" } },
];

export const scopeDescriptions = SCOPES;
