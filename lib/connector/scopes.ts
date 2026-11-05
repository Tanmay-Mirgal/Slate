import type { Role } from "@/lib/db/types";

/**
 * The permissions a connection can hold. A grant stores the scopes the user agreed to; what a request may
 * actually do is that set narrowed by the user's CURRENT role in the connected workspace (`scopesForRole`).
 */
export const SCOPES = {
  "slate:workspaces:read": "See the name and your role in the connected workspace",
  "slate:boards:read": "Read boards and their content (diagram, document, cost estimate)",
  "slate:boards:write": "Create and change boards, documents and sharing in this workspace",
  "slate:ai:generate": "Spend your AI credits to generate and review diagrams",
  "slate:comments:read": "Read comments on boards",
  "slate:events:read": "Read the workspace's event log (so missed notifications can be recovered)",
  "slate:webhooks:manage": "Register webhooks that notify the app when boards change",
} as const;

export type Scope = keyof typeof SCOPES;

export const ALL_SCOPES = Object.keys(SCOPES) as Scope[];

export const isScope = (value: unknown): value is Scope => typeof value === "string" && Object.prototype.hasOwnProperty.call(SCOPES, value);

/** Scopes only people who can edit boards may use. */
export const WRITE_SCOPES: readonly Scope[] = ["slate:boards:write"];

/**
 * What a member with `role` may do through a connection. Viewers read (and review, which only spends their
 * own credits); Admins and Editors can also write. This is evaluated on every request, so a downgrade takes
 * effect on the next call.
 */
export function scopesForRole(role: Role): Scope[] {
  if (role === "Admin" || role === "Editor") return [...ALL_SCOPES];
  return ALL_SCOPES.filter((s) => !WRITE_SCOPES.includes(s));
}

/**
 * Parses the space separated `scope` parameter. Returns the scopes (de-duplicated, in a stable order, with
 * `events:read` added whenever webhooks are requested: the log is how missed deliveries are healed) or the
 * names that are not part of the manifest.
 */
export function parseScopeParam(raw: string | null | undefined): { scopes: Scope[]; unknown: string[] } {
  const wanted = (raw ?? "").split(/\s+/).filter(Boolean);
  const unknown = wanted.filter((s) => !isScope(s));
  const set = new Set(wanted.filter(isScope));
  if (set.has("slate:webhooks:manage")) set.add("slate:events:read");
  return { scopes: ALL_SCOPES.filter((s) => set.has(s)), unknown };
}

/** True when a member with this role could hold every one of `scopes`. */
export const roleSatisfies = (role: Role, scopes: readonly Scope[]): boolean => {
  const allowed = new Set(scopesForRole(role));
  return scopes.every((s) => allowed.has(s));
};
