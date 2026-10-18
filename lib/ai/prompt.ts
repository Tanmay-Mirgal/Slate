import { iconHintsForPrompt } from "../canvas/icons-catalog";
import type { ChatMessage } from "./nvidia";
import type { DiagramKind } from "../diagram/graph";

export type Complexity = "simple" | "standard" | "detailed";

export const COMPLEXITY: Record<Complexity, { nodes: string; maxTokens: number; label: string }> = {
  simple: { nodes: "6 to 10", maxTokens: 3000, label: "Simple" },
  standard: { nodes: "12 to 20", maxTokens: 5000, label: "Standard" },
  detailed: { nodes: "20 to 32", maxTokens: 8000, label: "Detailed" },
};

export interface PromptInput {
  prompt: string;
  kind: DiagramKind | "auto";
  complexity: Complexity;
  /** Existing diagram in the Slate DSL when revising. */
  currentDsl?: string;
}

const EXAMPLE = `{
  "kind": "architecture",
  "title": "URL shortener",
  "direction": "right",
  "groups": [{ "id": "backend", "label": "Backend", "color": "blue" }],
  "nodes": [
    { "id": "client", "label": "Web client", "subtitle": "React SPA", "icon": "react" },
    { "id": "api", "label": "Shortener API", "subtitle": "Create & redirect", "icon": "nodedotjs", "group": "backend" },
    { "id": "cache", "label": "Redis", "subtitle": "Hot links", "icon": "redis", "group": "backend" },
    { "id": "db", "label": "PostgreSQL", "subtitle": "Link store", "icon": "postgresql", "group": "backend" }
  ],
  "edges": [
    { "from": "client", "to": "api", "label": "HTTPS" },
    { "from": "api", "to": "cache", "label": "lookup" },
    { "from": "api", "to": "db", "label": "SQL" }
  ]
}`;

export function systemPrompt(complexity: Complexity): string {
  return `You are Slate's diagram architect. You turn a request into a precise, readable diagram described as JSON. You reply with ONE JSON object and nothing else: no prose, no markdown fences, no comments.

SCHEMA
{
  "kind": "architecture" | "flowchart" | "erd" | "mindmap" | "sequence",
  "title": string,
  "direction": "down" | "right" | "auto",
  "groups": [ { "id": string, "label": string, "parent"?: groupId, "color"?: colorName } ],
  "nodes":  [ { "id": string, "label": string, "subtitle"?: string, "icon"?: string, "group"?: groupId, "shape"?: shape, "color"?: colorName, "fields"?: [ { "name": string, "type"?: string, "key"?: "pk"|"fk"|"unique" } ] } ],
  "edges":  [ { "from": nodeId, "to": nodeId, "label"?: string, "style"?: "solid"|"dashed", "arrow"?: "forward"|"both"|"none" } ],
  "messages": [ { "from": nodeId, "to": nodeId, "label": string, "kind"?: "sync"|"async"|"return" } ]   // sequence diagrams only
}
shape (flowchart nodes): "process" | "decision" | "terminator" | "io" | "data" | "document".
colorName: blue, green, purple, orange, teal, pink, indigo, yellow, red, gray.

RULES
1. Never output coordinates, sizes or hex colours. Layout is computed for you.
2. Pick the diagram kind that fits the request unless one is requested: architecture (systems, infrastructure, cloud, networks), flowchart (processes, algorithms, user flows, decisions), erd (database schemas), mindmap (brainstorms, concept breakdowns), sequence (interactions between actors over time).
3. Model the WHOLE request like a senior engineer: actors and entry points, edge/gateway, core services, data stores, asynchronous / event paths, third-party providers, and observability or security components where a real system of this kind has them. Do not invent components that do not belong.
4. Use concrete components, not vague layers. Each node is ONE thing (a service, a database, a queue, a provider). Put the technology in "subtitle" (e.g. "Node.js · gRPC") or use the product name as the label (e.g. "PostgreSQL"). Never create boxes called "Application Layer", "Backend", "Infrastructure" as nodes.
5. "icon": pick from the vocabulary below (product logo slug, cloud-service id or generic glyph). Prefer the product logo when the node IS that product. Omit "icon" when unsure; never invent names.
6. "groups": only for real boundaries (VPC, Kubernetes cluster, region, bounded context, trust zone, external providers). 2 to 6 nodes per group, at most 2 levels of nesting. Skip groups when they do not improve readability.
7. Every node must be connected. Edges follow real data / control flow (client -> edge -> services -> data). Label edges with the protocol or action ("HTTPS", "gRPC", "SQL", "publishes OrderPlaced", "Yes", "No"). Use style "dashed" for asynchronous / event flows.
8. ids are short lowercase snake_case and unique. Reference nodes and groups only by id.
9. Size: about ${COMPLEXITY[complexity].nodes} nodes. Quality and correctness beat quantity.
10. flowchart: start and end are "terminator", branching points are "decision" with "Yes"/"No" (or condition) edge labels, steps are "process", inputs/outputs "io", stores "data".
11. erd: each node is a table with "fields" (include a "pk" and "fk" keys where relevant); edges are relationships labelled like "1:N".
12. mindmap: exactly one root node; edges go parent -> child; at most 4 levels; short labels.
13. sequence: "nodes" are participants in left-to-right order; "messages" are in time order and include "return" messages.

ICON VOCABULARY
${iconHintsForPrompt()}

EXAMPLE (shape only; yours should be richer)
${EXAMPLE}`;
}

export function userPrompt(i: PromptInput): string {
  const kind = i.kind === "auto" ? "Choose the best diagram kind." : `Diagram kind: ${i.kind}.`;
  if (i.currentDsl?.trim()) {
    return `The user already has this diagram (compact text form):\n\n${i.currentDsl.trim()}\n\nApply this change and return the COMPLETE updated diagram as the JSON object. Keep everything that is not affected, and keep component names the same.\n\nChange requested: ${i.prompt}\n${kind}`;
  }
  return `Request: ${i.prompt}\n${kind}\nSize: ${COMPLEXITY[i.complexity].nodes} components.`;
}

export function buildMessages(i: PromptInput): ChatMessage[] {
  return [
    { role: "system", content: systemPrompt(i.complexity) },
    { role: "user", content: userPrompt(i) },
  ];
}

export function repairMessages(base: ChatMessage[], reply: string, problem: string): ChatMessage[] {
  return [
    ...base,
    { role: "assistant", content: reply.slice(0, 6000) },
    { role: "user", content: `That reply could not be used: ${problem}\nReply again with ONLY the corrected, complete JSON object (same schema).` },
  ];
}
