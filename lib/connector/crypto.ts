import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { connectorConfig, type EncryptionKeys } from "./config";

/* ------------------------------------------------------------------ tokens */

/** A random opaque token: `prefix` + 32 random bytes (base64url). Only its HMAC is ever stored. */
export function randomToken(prefix: string, bytes = 32): string {
  return prefix + randomBytes(bytes).toString("base64url");
}

/** HMAC-SHA256(pepper, token) as hex. The pepper lives in the environment, never in the database. */
export function hashToken(token: string, pepper: string = connectorConfig().tokenPepper): string {
  return createHmac("sha256", pepper).update(token).digest("hex");
}

/** Constant-time string comparison that does not leak the length of the secret either. */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export const sha256Hex = (value: string): string => createHash("sha256").update(value).digest("hex");

/* ------------------------------------------------------------------ PKCE */

/** RFC 7636: BASE64URL(SHA256(verifier)). */
export const pkceChallenge = (verifier: string): string => createHash("sha256").update(verifier).digest("base64url");

const VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/;
const CHALLENGE = /^[A-Za-z0-9\-_]{43}$/;

export const isValidCodeVerifier = (value: unknown): value is string => typeof value === "string" && VERIFIER.test(value);
export const isValidCodeChallenge = (value: unknown): value is string => typeof value === "string" && CHALLENGE.test(value);

export function verifyPkce(verifier: string, challenge: string): boolean {
  return isValidCodeVerifier(verifier) && safeEqual(pkceChallenge(verifier), challenge);
}

/* ------------------------------------------------------------------ AES-256-GCM (webhook secrets) */

const fingerprint = (key: Buffer): string => createHash("sha256").update(key).digest("hex").slice(0, 8);

/**
 * Encrypts a secret that must be recoverable (a webhook signing secret). Format:
 * `enc:v1:<key fingerprint>:<iv>:<tag>:<ciphertext>`. The fingerprint says which key was used, so keys can
 * be rotated: set the new one as CONNECTOR_ENCRYPTION_KEY and keep the old one in ..._PREVIOUS. `aad` binds
 * the ciphertext to its row so it cannot be copied onto another one.
 */
export function encryptSecret(plaintext: string, aad: string, keys: EncryptionKeys = connectorConfig().encryption): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keys.current, iv);
  cipher.setAAD(Buffer.from(aad));
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["enc", "v1", fingerprint(keys.current), iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(":");
}

function keyFor(payload: string, keys: EncryptionKeys): Buffer {
  const fp = payload.split(":")[2];
  for (const k of [keys.current, keys.previous]) if (k && fingerprint(k) === fp) return k;
  throw new Error("The stored secret was encrypted with a key that is no longer configured");
}

export function decryptSecret(payload: string, aad: string, keys: EncryptionKeys = connectorConfig().encryption): string {
  const parts = payload.split(":");
  if (parts.length !== 6 || parts[0] !== "enc" || parts[1] !== "v1") throw new Error("Unrecognised secret format");
  const decipher = createDecipheriv("aes-256-gcm", keyFor(payload, keys), Buffer.from(parts[3], "base64url"));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(parts[4], "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(parts[5], "base64url")), decipher.final()]).toString("utf8");
}

/** True when the payload was written with an older key, i.e. it should be re-encrypted. */
export const usesOldKey = (payload: string, keys: EncryptionKeys = connectorConfig().encryption): boolean => payload.split(":")[2] !== fingerprint(keys.current);

/* ------------------------------------------------------------------ webhook signatures */

export const WEBHOOK_SECRET_PREFIX = "whsec_";
export const newWebhookSecret = (): string => randomToken(WEBHOOK_SECRET_PREFIX);

/** `v1=<hex HMAC-SHA256(secret, "<timestamp>.<rawBody>")>` as sent in X-CP-Signature. */
export function signWebhookBody(secret: string, timestampSeconds: number, rawBody: string): string {
  return `v1=${createHmac("sha256", secret).update(`${timestampSeconds}.${rawBody}`).digest("hex")}`;
}

/** What a receiver does: recompute, compare in constant time, and refuse stale timestamps. */
export function verifyWebhookSignature(secret: string, timestampSeconds: number, rawBody: string, header: string, opts: { nowSeconds?: number; toleranceSeconds?: number } = {}): boolean {
  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestampSeconds) > (opts.toleranceSeconds ?? 300)) return false;
  const expected = signWebhookBody(secret, timestampSeconds, rawBody);
  return header.split(",").some((candidate) => safeEqual(candidate.trim(), expected));
}

/* ------------------------------------------------------------------ ULID (event ids) */

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
let lastTime = -1;
let lastRandom: number[] = [];

function randomDigits(): number[] {
  const bytes = randomBytes(10); // 80 bits = 16 base32 digits
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const byte of bytes) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out.push((acc >> (bits - 5)) & 31);
      bits -= 5;
      acc &= (1 << bits) - 1;
    }
  }
  return out;
}

/**
 * A ULID: 48 bits of millisecond time then 80 random bits, Crockford base32. Ids sort by creation time and are
 * strictly increasing within this process, even inside one millisecond.
 */
export function newUlid(now = Date.now()): string {
  let time = Math.max(now, lastTime);
  let random: number[];
  if (time === lastTime) {
    random = [...lastRandom];
    let i = random.length - 1;
    while (i >= 0 && random[i] === 31) random[i--] = 0;
    if (i < 0) {
      time += 1; // 2^80 ids in one millisecond: move on to the next one
      random = randomDigits();
    } else random[i] += 1;
  } else random = randomDigits();
  lastTime = time;
  lastRandom = random;

  let stamp = "";
  let t = time;
  for (let i = 0; i < 10; i++) {
    stamp = CROCKFORD[t % 32] + stamp;
    t = Math.floor(t / 32);
  }
  return stamp + random.map((d) => CROCKFORD[d]).join("");
}

/* ------------------------------------------------------------------ canonical JSON */

/** JSON with sorted keys, so two bodies that mean the same thing hash the same (idempotency keys). */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
