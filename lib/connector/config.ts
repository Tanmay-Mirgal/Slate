/**
 * Connector configuration. Kept free of imports from the rest of the app so that it can be read from
 * anywhere (the database layer, the proxy, boot scripts) without pulling anything in.
 *
 * The whole connector is off unless CONNECTOR_ENABLED=true. With the flag off nothing in here is evaluated
 * beyond that one comparison, so the product behaves exactly as it did before the connector existed.
 */

export const CONNECTOR_VERSION = "1.0.0";
export const PROTOCOL = "cp1";
export const SERVICE = "slate";
export const SERVICE_DISPLAY_NAME = "Slate";

/** What the manifest advertises (`limits`) and what the request pipeline enforces. */
export const LIMITS = {
  requestsPerMinute: 120,
  maxBodyBytes: 1_048_576,
  webhookMaxEndpoints: 5,
} as const;

export const TOKEN_PREFIX = { access: "cp1_slate_", refresh: "cp1r_slate_" } as const;

/** Where the integration guide lives (advertised in the manifest). */
export const DOCS_URL = "https://github.com/Tanmay-Mirgal/Slate/blob/main/docs/CONNECTOR.md";

export const TTL_MS = {
  authCode: 60_000,
  /** A redeemed code is remembered for a while so a second redemption can be recognised and punished. */
  usedCode: 10 * 60_000,
  access: 60 * 60_000,
  refresh: 90 * 24 * 60 * 60_000,
  idempotency: 24 * 60 * 60_000,
  operations: 7 * 24 * 60 * 60_000,
  events: 7 * 24 * 60 * 60_000,
  audit: 90 * 24 * 60 * 60_000,
} as const;

const DEFAULT_ORIGIN = "https://slate.tanmaymirgal.dev";

export interface EncryptionKeys {
  current: Buffer;
  /** The key that was current before the last rotation; only used to read old ciphertext. */
  previous?: Buffer;
}

export interface ConnectorConfig {
  /** Public origin of this deployment, no trailing slash. */
  baseUrl: string;
  hubName: string;
  clientId: string;
  clientSecret: string;
  redirectUris: readonly string[];
  tokenPepper: string;
  encryption: EncryptionKeys;
  dispatcher: "inline" | "external";
}

export class ConnectorConfigError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`The connector is enabled (CONNECTOR_ENABLED=true) but its configuration is not usable:\n - ${problems.join("\n - ")}`);
    this.name = "ConnectorConfigError";
    this.problems = problems;
  }
}

type Env = Record<string, string | undefined>;

export function connectorEnabled(env: Env = process.env): boolean {
  return env.CONNECTOR_ENABLED === "true";
}

const HEX_KEY = /^[0-9a-fA-F]{64}$/;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** https everywhere; plain http only for a local development server. Exact strings, no wildcards, no fragments. */
export function redirectUriProblem(value: string, production: boolean): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return `"${value}" is not a valid URL`;
  }
  if (value.includes("*")) return `"${value}" contains a wildcard (redirect URIs are matched exactly)`;
  if (url.hash) return `"${value}" has a fragment`;
  if (url.username || url.password) return `"${value}" has credentials in it`;
  if (url.protocol === "https:") return null;
  if (url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname) && !production) return null;
  return `"${value}" must use https (http is only allowed for localhost outside production)`;
}

export function parseConnectorEnv(env: Env = process.env): { ok: true; config: ConnectorConfig } | { ok: false; problems: string[] } {
  const problems: string[] = [];
  const production = env.NODE_ENV === "production";

  const clientId = (env.CONNECTOR_HUB_CLIENT_ID ?? "").trim();
  if (!clientId) problems.push("CONNECTOR_HUB_CLIENT_ID is not set");

  const clientSecret = env.CONNECTOR_HUB_CLIENT_SECRET ?? "";
  if (clientSecret.length < 32) problems.push("CONNECTOR_HUB_CLIENT_SECRET must be at least 32 characters");

  const redirectUris = (env.CONNECTOR_HUB_REDIRECT_URIS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (redirectUris.length === 0) problems.push("CONNECTOR_HUB_REDIRECT_URIS must list at least one redirect URI (comma separated)");
  for (const uri of redirectUris) {
    const p = redirectUriProblem(uri, production);
    if (p) problems.push(`CONNECTOR_HUB_REDIRECT_URIS: ${p}`);
  }

  const pepper = env.CONNECTOR_TOKEN_PEPPER ?? "";
  if (Buffer.byteLength(pepper) < 32) problems.push("CONNECTOR_TOKEN_PEPPER must be at least 32 bytes (try: openssl rand -base64 48)");
  else if (new Set(pepper).size < 8) problems.push("CONNECTOR_TOKEN_PEPPER is too repetitive to be a real secret");

  const key = env.CONNECTOR_ENCRYPTION_KEY ?? "";
  if (!HEX_KEY.test(key)) problems.push("CONNECTOR_ENCRYPTION_KEY must be 64 hex characters (try: openssl rand -hex 32)");
  const previousKey = env.CONNECTOR_ENCRYPTION_KEY_PREVIOUS ?? "";
  if (previousKey && !HEX_KEY.test(previousKey)) problems.push("CONNECTOR_ENCRYPTION_KEY_PREVIOUS must be 64 hex characters when set");

  const dispatcher = (env.CONNECTOR_DISPATCHER ?? "inline").trim();
  if (dispatcher !== "inline" && dispatcher !== "external") problems.push('CONNECTOR_DISPATCHER must be "inline" or "external"');

  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    config: {
      baseUrl: (env.CONNECTOR_BASE_URL || env.NEXT_PUBLIC_SITE_URL || DEFAULT_ORIGIN).trim().replace(/\/+$/, ""),
      hubName: (env.CONNECTOR_HUB_NAME ?? "").trim().slice(0, 60) || "Hub",
      clientId,
      clientSecret,
      redirectUris,
      tokenPepper: pepper,
      encryption: { current: Buffer.from(key, "hex"), ...(previousKey ? { previous: Buffer.from(previousKey, "hex") } : {}) },
      dispatcher: dispatcher as "inline" | "external",
    },
  };
}

let memo: { signature: string; config: ConnectorConfig } | null = null;

const WATCHED = [
  "CONNECTOR_HUB_NAME",
  "CONNECTOR_HUB_CLIENT_ID",
  "CONNECTOR_HUB_CLIENT_SECRET",
  "CONNECTOR_HUB_REDIRECT_URIS",
  "CONNECTOR_TOKEN_PEPPER",
  "CONNECTOR_ENCRYPTION_KEY",
  "CONNECTOR_ENCRYPTION_KEY_PREVIOUS",
  "CONNECTOR_DISPATCHER",
  "CONNECTOR_BASE_URL",
  "NEXT_PUBLIC_SITE_URL",
  "NODE_ENV",
] as const;

/** The validated configuration. Throws `ConnectorConfigError` (with every problem listed) when it is unusable. */
export function connectorConfig(env: Env = process.env): ConnectorConfig {
  const signature = WATCHED.map((k) => env[k] ?? "").join("\u0000");
  if (memo && memo.signature === signature) return memo.config;
  const parsed = parseConnectorEnv(env);
  if (!parsed.ok) throw new ConnectorConfigError(parsed.problems);
  memo = { signature, config: parsed.config };
  return parsed.config;
}

/**
 * Boot-time check: does nothing when the connector is off, throws a readable error when it is on and
 * misconfigured. Called from instrumentation.ts (web app) and from the long-running scripts.
 */
export function assertConnectorEnv(env: Env = process.env): ConnectorConfig | null {
  if (!connectorEnabled(env)) return null;
  return connectorConfig(env);
}
