import { promises as dns } from "node:dns";
import { isIP } from "node:net";

/**
 * Slate makes outbound requests to addresses supplied by an API caller, so every target is checked first: no
 * internal, loopback, private, link-local or metadata addresses, whatever the hostname says. The check runs when an
 * endpoint is registered AND again right before each delivery (a name can be re-pointed later), and the request is
 * then sent to the very address that was checked, so it cannot be re-resolved in between.
 */

export class WebhookUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookUrlError";
  }
}

const v4Parts = (ip: string) => ip.split(".").map(Number) as [number, number, number, number];

function blockedV4(ip: string): boolean {
  const [a, b, c] = v4Parts(ip);
  return (
    a === 0 || // "this" network
    a === 10 || // RFC 1918
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT (also Alibaba metadata)
    (a === 169 && b === 254) || // link-local, cloud metadata (169.254.169.254)
    (a === 172 && b >= 16 && b <= 31) || // RFC 1918
    (a === 192 && b === 168) || // RFC 1918
    (a === 192 && b === 0 && (c === 0 || c === 2)) || // IETF protocol / TEST-NET-1
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    (a === 198 && b === 51 && c === 100) || // TEST-NET-2
    (a === 203 && b === 0 && c === 113) || // TEST-NET-3
    a >= 224 || // multicast, reserved, broadcast
    ip === "168.63.129.16" // Azure platform address
  );
}

/** Eight 16-bit groups of an IPv6 address (handles "::" and a trailing dotted IPv4). */
function expandV6(ip: string): number[] | null {
  let text = ip.toLowerCase().split("%")[0];
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (dotted) {
    const [a, b, c, d] = v4Parts(dotted[1]);
    text = text.slice(0, -dotted[1].length) + ((a << 8) | b).toString(16) + ":" + ((c << 8) | d).toString(16);
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 0) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail].map((g) => parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

function blockedV6(ip: string): boolean {
  const g = expandV6(ip);
  if (!g) return true;
  const embedded = (hi: number, lo: number) => blockedV4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  if (g.every((x) => x === 0)) return true; // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local (incl. fd00:ec2::254, AWS metadata)
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return embedded(g[6], g[7]); // IPv4-mapped
  if (g.slice(0, 6).every((x) => x === 0)) return true; // IPv4-compatible
  if (g[0] === 0x0064 && g[1] === 0xff9b) return true; // NAT64
  if (g[0] === 0x2002) return embedded(g[1], g[2]); // 6to4
  return false;
}

export function isBlockedIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return blockedV4(ip);
  if (family === 6) return blockedV6(ip);
  return true;
}

export interface WebhookTarget {
  url: URL;
  /** The address that passed the check; the request connects to this, not to the name. */
  ip: string;
  family: 4 | 6;
}

export interface UrlRules {
  /** Production requires https. */
  requireHttps: boolean;
  /** Development / tests only: allow addresses that would otherwise be refused (a receiver on localhost). */
  allowPrivate: boolean;
}

/** Throws `WebhookUrlError` with a message that is safe to show the caller. */
export async function resolveWebhookTarget(raw: string, rules: UrlRules): Promise<WebhookTarget> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new WebhookUrlError("The URL is not valid");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && !rules.requireHttps)) throw new WebhookUrlError(rules.requireHttps ? "The URL must use https" : "The URL must use http or https");
  if (url.username || url.password) throw new WebhookUrlError("The URL must not contain credentials");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!host) throw new WebhookUrlError("The URL has no host");
  if (!rules.allowPrivate && (host === "localhost" || /\.(localhost|local|internal|localdomain)$/i.test(host))) throw new WebhookUrlError("The URL points at an internal address");

  let addresses: { address: string; family: number }[];
  if (isIP(host)) addresses = [{ address: host, family: isIP(host) }];
  else {
    try {
      addresses = await dns.lookup(host, { all: true, verbatim: true });
    } catch {
      throw new WebhookUrlError("The host name could not be resolved");
    }
  }
  if (addresses.length === 0) throw new WebhookUrlError("The host name could not be resolved");
  // every address must be public: a name that also points inside would be reachable by a later lookup
  if (!rules.allowPrivate && addresses.some((a) => isBlockedIp(a.address))) throw new WebhookUrlError("The URL points at a private, internal or reserved address");
  const first = addresses[0];
  return { url, ip: first.address, family: first.family === 6 ? 6 : 4 };
}
