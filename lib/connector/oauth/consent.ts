import { createHmac } from "node:crypto";
import { connectorConfig } from "../config";
import { safeEqual } from "../crypto";
import { ALL_SCOPES, type Scope } from "../scopes";
import type { AuthorizeRequest } from "./authorize";

/**
 * The consent form posts back to the server, which must not trust anything in it. The validated request is
 * therefore carried in a signed blob (bound to the signed-in user, valid for 10 minutes): a form that was
 * tampered with, replayed for another account, or built by someone else simply fails verification.
 */

const VALID_MS = 10 * 60_000;

interface Payload extends AuthorizeRequest {
  userId: string;
  exp: number;
}

const sign = (payload: string) => createHmac("sha256", connectorConfig().tokenPepper).update(`consent.v1.${payload}`).digest("base64url");

export function signConsent(request: AuthorizeRequest, userId: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ ...request, userId, exp: now + VALID_MS } satisfies Payload)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifyConsent(blob: string, userId: string, now = Date.now()): AuthorizeRequest | null {
  const [payload, signature, ...rest] = blob.split(".");
  if (!payload || !signature || rest.length > 0 || !safeEqual(signature, sign(payload))) return null;
  try {
    const p = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<Payload>;
    if (p.userId !== userId || typeof p.exp !== "number" || p.exp < now) return null;
    if (typeof p.clientId !== "string" || typeof p.redirectUri !== "string" || typeof p.state !== "string" || typeof p.codeChallenge !== "string") return null;
    if (!Array.isArray(p.scopes) || !p.scopes.every((s): s is Scope => ALL_SCOPES.includes(s as Scope))) return null;
    return { clientId: p.clientId, redirectUri: p.redirectUri, state: p.state, codeChallenge: p.codeChallenge, scopes: p.scopes };
  } catch {
    return null;
  }
}
