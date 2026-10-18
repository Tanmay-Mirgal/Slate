import { parse } from "yaml";
import { normalizeGraph, resolveIconName, slug, type GEdge, type GGroup, type GNode, type Graph } from "../diagram/graph";
import { code, table, type ImportResult } from "./types";

/**
 * docker-compose.yml -> architecture graph + documentation. Fully deterministic (no AI, no credits):
 * services become nodes, `depends_on` and hostnames found in environment variables become edges,
 * user-defined networks become groups, named volumes become storage nodes, and published ports
 * become an entry point. Secrets in `environment` are never copied into the documentation.
 */

interface Service {
  name: string;
  image?: string;
  build?: string;
  ports: { host?: string; container: string; protocol: string }[];
  expose: string[];
  env: { name: string; value?: string }[];
  dependsOn: string[];
  volumes: { source?: string; target: string; named: boolean }[];
  networks: string[];
  command?: string;
  restart?: string;
  healthcheck?: string;
  replicas?: number;
  profiles: string[];
}

const HOST_VAR = /(host|url|uri|addr|endpoint|server|broker|dsn|connection|conn|upstream|backend|target|database|cache|queue)/i;

const SECRET_NAME = /(pass(word|wd)?|secret|token|api[-_]?key|private[-_]?key|credential|auth|signing|salt|dsn)/i;

const asRecord = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const asString = (v: unknown): string | undefined => (typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : undefined);

function parsePort(p: unknown): Service["ports"][number] | null {
  if (typeof p === "number") return { container: String(p), protocol: "tcp" };
  if (typeof p === "string") {
    const [mapping, proto] = p.replace(/["']/g, "").split("/");
    const parts = mapping.split(":");
    const container = parts[parts.length - 1];
    const host = parts.length >= 2 ? parts[parts.length - 2] : undefined;
    if (!container) return null;
    return { host: host || undefined, container, protocol: proto || "tcp" };
  }
  const r = asRecord(p);
  if (r && r.target !== undefined) return { host: asString(r.published), container: String(r.target), protocol: asString(r.protocol) ?? "tcp" };
  return null;
}

function parseEnv(v: unknown): Service["env"] {
  if (Array.isArray(v)) {
    return v.flatMap((e) => {
      const s = asString(e);
      if (!s) return [];
      const i = s.indexOf("=");
      return [i < 0 ? { name: s } : { name: s.slice(0, i), value: s.slice(i + 1) }];
    });
  }
  const r = asRecord(v);
  if (!r) return [];
  return Object.entries(r).map(([name, value]) => ({ name, value: value === null || value === undefined ? undefined : String(value) }));
}

function parseVolumes(v: unknown): Service["volumes"] {
  if (!Array.isArray(v)) return [];
  const out: Service["volumes"] = [];
  for (const item of v) {
    if (typeof item === "string") {
      const parts = item.split(":");
      if (parts.length === 1) out.push({ target: parts[0], named: false });
      else {
        const source = parts[0];
        out.push({ source, target: parts[1], named: !/^[./~$]|[\\/]/.test(source) });
      }
    } else {
      const r = asRecord(item);
      if (r && r.target) {
        const source = asString(r.source);
        out.push({ source, target: String(r.target), named: r.type === "volume" || (!!source && !/^[./~$]|[\\/]/.test(source)) });
      }
    }
  }
  return out;
}

function listOrKeys(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => asString(x)).filter((x): x is string => !!x);
  const r = asRecord(v);
  return r ? Object.keys(r) : [];
}

function commandText(v: unknown): string | undefined {
  if (Array.isArray(v)) return v.map(String).join(" ");
  return asString(v);
}

function parseService(name: string, raw: unknown): Service {
  const r = asRecord(raw) ?? {};
  const build = typeof r.build === "string" ? r.build : asString(asRecord(r.build)?.context);
  const health = asRecord(r.healthcheck);
  const deploy = asRecord(r.deploy);
  const replicas = Number(deploy?.replicas ?? r.scale);
  return {
    name,
    image: asString(r.image),
    build,
    ports: (Array.isArray(r.ports) ? r.ports : []).map(parsePort).filter((p): p is NonNullable<typeof p> => !!p),
    expose: (Array.isArray(r.expose) ? r.expose : []).map(String),
    env: parseEnv(r.environment),
    dependsOn: [...listOrKeys(r.depends_on), ...listOrKeys(r.links).map((l) => l.split(":")[0])],
    volumes: parseVolumes(r.volumes),
    networks: listOrKeys(r.networks),
    command: commandText(r.command),
    restart: asString(r.restart),
    healthcheck: health ? commandText(health.test)?.replace(/^CMD(-SHELL)?\s+/, "") : undefined,
    replicas: Number.isFinite(replicas) && replicas > 1 ? Math.floor(replicas) : undefined,
    profiles: listOrKeys(r.profiles),
  };
}

/** True when the text looks like a compose file; returns the parsed document for reuse. */
export function parseComposeDocument(text: string): Record<string, unknown> | null {
  if (!/^\s*services\s*:/m.test(text)) return null;
  try {
    const doc = asRecord(parse(text));
    const services = asRecord(doc?.services);
    return doc && services && Object.keys(services).length > 0 ? doc : null;
  } catch {
    return null;
  }
}

function imageName(image: string): string {
  const withoutTag = image.split("@")[0].replace(/:[^/]*$/, "");
  return withoutTag.split("/").pop() ?? withoutTag;
}

const SCHEME_LABEL: Record<string, string> = { postgres: "SQL", postgresql: "SQL", mysql: "SQL", mariadb: "SQL", mongodb: "MongoDB", redis: "Redis", rediss: "Redis", amqp: "AMQP", amqps: "AMQP", kafka: "Kafka", http: "HTTP", https: "HTTPS", grpc: "gRPC", ws: "WebSocket", nats: "NATS" };

export function composeToImport(text: string): ImportResult | null {
  const doc = parseComposeDocument(text);
  if (!doc) return null;
  const warnings: string[] = [];
  const rawServices = asRecord(doc.services)!;
  const names = Object.keys(rawServices).slice(0, 60);
  if (Object.keys(rawServices).length > names.length) warnings.push(`Only the first ${names.length} services were drawn.`);
  const services = names.map((n) => parseService(n, rawServices[n]));
  const byName = new Map(services.map((s) => [s.name.toLowerCase(), s]));
  const title = (asString(doc.name) ? `${asString(doc.name)} stack` : "Docker Compose stack").slice(0, 80);

  /* ----- nodes */
  const nodes: GNode[] = services.map((s) => {
    const published = s.ports.filter((p) => p.host).map((p) => p.host);
    const bits = [s.image ?? (s.build ? `build ${s.build}` : undefined), published.length ? `:${published.slice(0, 2).join(", :")}` : undefined, s.replicas ? `${s.replicas} replicas` : undefined].filter(Boolean);
    const icon = (s.image ? resolveIconName(imageName(s.image), s.name) : undefined) ?? resolveIconName(undefined, s.name) ?? "lucide:Container";
    return { id: slug(s.name), label: s.name, subtitle: bits.join(" · ") || undefined, icon };
  });
  const idOf = (name: string) => slug(name);

  /* ----- edges: depends_on first, then hostnames referenced in environment values (these carry the protocol) */
  const edges = new Map<string, GEdge>();
  for (const s of services) {
    for (const dep of s.dependsOn) {
      if (byName.has(dep.toLowerCase()) && dep.toLowerCase() !== s.name.toLowerCase()) edges.set(`${s.name}>${dep}`, { from: idOf(s.name), to: idOf(dep), label: "depends on", style: "dashed" });
    }
  }
  for (const s of services) {
    for (const e of s.env) {
      const value = e.value ?? "";
      for (const target of services) {
        if (target.name === s.name) continue;
        const host = target.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const url = new RegExp(`^([a-z][a-z0-9+.-]*)://(?:[^@/\\s]*@)?${host}(?::\\d+)?(?:[/?]|$)`, "i").exec(value);
        // A bare hostname only counts when the variable's name says it points somewhere (DB_HOST, REDIS_ADDR...).
        const plain = HOST_VAR.test(e.name) && (new RegExp(`(^|[=@\\s,])${host}(?::\\d+)?(/|$|\\s)`, "i").test(value) || value.toLowerCase() === target.name.toLowerCase());
        if (!url && !plain) continue;
        const label = url ? SCHEME_LABEL[url[1].toLowerCase()] ?? url[1].toUpperCase() : undefined;
        edges.set(`${s.name}>${target.name}`, { from: idOf(s.name), to: idOf(target.name), label, style: "solid" });
      }
    }
  }

  /* ----- entry point for published ports */
  const exposed = services.filter((s) => s.ports.some((p) => p.host));
  if (exposed.length > 0) {
    nodes.unshift({ id: "clients", label: "Clients", subtitle: "Browser · API consumers", icon: "lucide:Globe" });
    for (const s of exposed) {
      const p = s.ports.find((x) => x.host)!;
      edges.set(`clients>${s.name}`, { from: "clients", to: idOf(s.name), label: `:${p.host}`, style: "solid" });
    }
  }

  /* ----- named volumes */
  const topVolumes = new Set(Object.keys(asRecord(doc.volumes) ?? {}));
  const volumeUse = new Map<string, { service: string; target: string }[]>();
  for (const s of services) {
    for (const v of s.volumes) {
      if (!v.named || !v.source) continue;
      volumeUse.set(v.source, [...(volumeUse.get(v.source) ?? []), { service: s.name, target: v.target }]);
    }
  }
  for (const [name, uses] of Array.from(volumeUse.entries()).slice(0, 12)) {
    const id = `vol_${slug(name)}`;
    nodes.push({ id, label: name, subtitle: topVolumes.has(name) ? "Docker volume" : "Volume", shape: "data", icon: "lucide:HardDrive" });
    for (const u of uses) edges.set(`${u.service}>vol:${name}`, { from: idOf(u.service), to: id, label: u.target, style: "dotted", arrow: "none" });
  }

  /* ----- user-defined networks become groups (a service lands in the first custom network it joins) */
  const groups: GGroup[] = [];
  const customNetworks = new Set(Object.keys(asRecord(doc.networks) ?? {}).filter((n) => n !== "default"));
  const members = new Map<string, Service[]>();
  for (const s of services) {
    const net = s.networks.find((n) => customNetworks.has(n));
    if (net) members.set(net, [...(members.get(net) ?? []), s]);
  }
  for (const [net, list] of members) {
    if (list.length < 2) continue;
    const gid = `net_${slug(net)}`;
    groups.push({ id: gid, label: `${net} network` });
    for (const m of list) {
      const node = nodes.find((n) => n.id === idOf(m.name));
      if (node) node.group = gid;
    }
  }

  const graphIn: Graph = { kind: "architecture", title, direction: "right", nodes, groups, edges: Array.from(edges.values()) };
  const { graph, warnings: normWarnings } = normalizeGraph(graphIn, "architecture");
  warnings.push(...normWarnings.filter((w) => !/Removed empty groups/.test(w)));

  return { source: "compose", title, graph, markdown: composeMarkdown(title, services, doc, volumeUse, Array.from(customNetworks)), warnings };
}

/* ------------------------------------------------------------------ docs */

function describeEnv(s: Service): { name: string; note: string }[] {
  return s.env.map((e) => {
    const secret = SECRET_NAME.test(e.name);
    const ref = e.value ? /^\$\{([A-Za-z_][A-Za-z0-9_]*)(?:(:?[-?])([^}]*))?\}$/.exec(e.value) : null;
    let note = secret ? "Secret. Provide it through an `.env` file or your secrets manager." : e.value === undefined || e.value === "" ? "Set at runtime." : "Configured in the compose file.";
    if (ref) {
      if (ref[2]?.endsWith("?")) note = `Required${ref[3] ? `: ${ref[3]}` : ""}.`;
      else if (ref[2]?.endsWith("-") && !secret) note = `Defaults to ${code(ref[3] || "empty")} when ${code(ref[1])} is unset.`;
      else if (!secret) note = `Taken from ${code(ref[1])} in the shell or \`.env\`.`;
    }
    return { name: e.name, note };
  });
}

function composeMarkdown(title: string, services: Service[], doc: Record<string, unknown>, volumeUse: Map<string, { service: string; target: string }[]>, networks: string[]): string {
  const out: string[] = [];
  out.push(`# ${title}`, "", `> Generated by Slate from a Docker Compose file: ${services.length} service${services.length === 1 ? "" : "s"}${volumeUse.size ? `, ${volumeUse.size} volume${volumeUse.size === 1 ? "" : "s"}` : ""}${networks.length ? `, ${networks.length} network${networks.length === 1 ? "" : "s"}` : ""}.`, "");

  out.push("## Overview", "");
  const entry = services.filter((s) => s.ports.some((p) => p.host));
  out.push(
    entry.length
      ? `${entry.map((s) => code(s.name)).join(", ")} ${entry.length === 1 ? "is" : "are"} reachable from the host; everything else is internal to the Compose network.`
      : "No service publishes a port to the host, so the stack is reachable only from inside the Compose network.",
    ""
  );
  out.push(
    table(
      ["Service", "Image / build", "Published ports", "Depends on"],
      services.map((s) => [code(s.name), s.image ? code(s.image) : s.build ? `build ${code(s.build)}` : "—", s.ports.filter((p) => p.host).map((p) => `${p.host}→${p.container}`).join(", "), s.dependsOn.map((d) => code(d)).join(", ")])
    ),
    ""
  );

  out.push("## Services", "");
  for (const s of services) {
    out.push(`### ${s.name}`, "");
    if (s.image) out.push(`- **Image:** ${code(s.image)}`);
    if (s.build) out.push(`- **Build context:** ${code(s.build)}`);
    if (s.command) out.push(`- **Command:** ${code(s.command)}`);
    const ports = s.ports.map((p) => (p.host ? `${p.host}→${p.container}/${p.protocol}` : `${p.container}/${p.protocol} (internal)`));
    if (ports.length) out.push(`- **Ports:** ${ports.map(code).join(", ")}`);
    if (s.expose.length) out.push(`- **Exposed to other services:** ${s.expose.map(code).join(", ")}`);
    if (s.dependsOn.length) out.push(`- **Depends on:** ${s.dependsOn.map(code).join(", ")}`);
    if (s.volumes.length) out.push(`- **Volumes:** ${s.volumes.map((v) => (v.source ? `${code(v.source)} → ${code(v.target)}` : code(v.target))).join(", ")}`);
    if (s.networks.length) out.push(`- **Networks:** ${s.networks.map(code).join(", ")}`);
    if (s.healthcheck) out.push(`- **Health check:** ${code(s.healthcheck)}`);
    if (s.restart) out.push(`- **Restart policy:** ${code(s.restart)}`);
    if (s.replicas) out.push(`- **Replicas:** ${s.replicas}`);
    if (s.profiles.length) out.push(`- **Profiles:** ${s.profiles.map(code).join(", ")} (only started when enabled)`);
    out.push("");
  }

  const portRows = services.flatMap((s) => s.ports.filter((p) => p.host).map((p) => [p.host, p.container, code(s.name), p.protocol.toUpperCase()]));
  if (portRows.length) out.push("## Port map", "", table(["Host", "Container", "Service", "Protocol"], portRows), "");

  const envRows = services.flatMap((s) => describeEnv(s).map((e) => [code(e.name), code(s.name), e.note]));
  if (envRows.length) out.push("## Environment requirements", "", "Values are intentionally left out of this document.", "", table(["Variable", "Service", "Notes"], envRows), "");

  const volumeRows = Array.from(volumeUse.entries()).map(([name, uses]) => [code(name), uses.map((u) => `${code(u.service)} at ${code(u.target)}`).join(", ")]);
  if (volumeRows.length || networks.length) {
    out.push("## Networks & volumes", "");
    if (networks.length) out.push(`- **Networks:** ${networks.map(code).join(", ")}`, "");
    if (volumeRows.length) out.push(table(["Volume", "Mounted by"], volumeRows), "");
  }

  const names = services.map((s) => s.name);
  out.push("## Run it", "", "```bash", "docker compose up -d", "docker compose ps", `docker compose logs -f ${names[0] ?? "<service>"}`, "docker compose down", "```", "");
  const top = asString(doc.name);
  if (top) out.push(`Compose project name: ${code(top)}.`, "");
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
