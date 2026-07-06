import { NextResponse } from "next/server";
import ELK from "elkjs/lib/elk.bundled.js";

const elk = new ELK();


export async function POST(req: Request) {
  try {
    const { prompt } = await req.json();

    if (!prompt) {
      return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
    }

    const apiKey = process.env.GROQ_API_KEY;

    if (!apiKey || apiKey === "gsk_your_groq_api_key_here") {
      // Fallback: Generate smart architecture diagram if GROQ_API_KEY is not set yet
      const fallbackElements = generateSmartFallbackDiagram(prompt);
      return NextResponse.json({ elements: fallbackElements, source: "slate-fallback" });
    }

    const systemPrompt = `You are Slate AI.

Your responsibility is to generate engineering-quality architecture diagrams comparable to Eraser.io.

You are NOT generating dashboards.

You are NOT generating grouped cards.

You are designing software architecture.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

VISUAL PHILOSOPHY

Think like an engineer manually designing a diagram on a whiteboard.

Do NOT think like a UI designer.

Do NOT think like a dashboard builder.

Think like

AWS

Stripe

Netflix

Google

Uber

Cloudflare

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

MOST IMPORTANT RULE

Prefer INDIVIDUAL COMPONENTS.

Do NOT aggressively group services.

Containers should ONLY organize related components.

Containers should NEVER hide architecture.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

BAD

Application Layer

┌──────────────┐

Authentication

Workspace

Notification

Analytics

Storage

AI

└──────────────┘

GOOD

Authentication

Workspace

Notification

Analytics

Storage

AI Engine

All visible individually.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Containers should contain

3–6 related nodes only.

Never 15.

Never 20.

Never giant boxes.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

LAYOUT

The diagram should naturally flow.

Nodes should occupy both X and Y directions.

Never produce

□□□□□□□□□□□□□□□□□□□□□□□□□□□□□□

Instead produce

□□□□□□

□□□□□□□□

□□□□□□□□

□□□□□□

Use the canvas efficiently.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

LAYERS

Users

↓

Frontend

↓

Gateway

↓

Business Services

↓

Shared Services

↓

Data Layer

↓

Infrastructure

↓

External Services

Never skip layers.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

NODE DETAIL

Every node must include

Icon

Title

Technology

Responsibility

Short Description

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

VISUAL STYLE

Small cards.

Lots of whitespace.

Thin borders.

Icons.

Readable labels.

Rounded corners.

Professional typography.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

EDGES

Use

Orthogonal routing

Rounded corners

Magnetic ports

Shortest path

Automatic rerouting

Edge labels

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

SPACING

Every node must have

120–180 px horizontal spacing.

100–150 px vertical spacing.

Containers

48 px padding.

80 px margins.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

COMPONENT EXPANSION

Expand important systems.

Authentication

↓

OAuth

↓

JWT

↓

RBAC

↓

Sessions

↓

MFA

Instead of

Authentication Service

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DATABASE

Expand

PostgreSQL

↓

Users

Projects

Workspaces

Permissions

Audit Logs

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

AI

Expand

AI Engine

↓

Prompt Builder

↓

Context Manager

↓

RAG

↓

Embedding

↓

LLM Gateway

↓

Streaming

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

RENDERING

The architecture should look handcrafted.

Never perfectly symmetrical.

Never dashboard-like.

Never card-grid.

Never PowerPoint.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

QUALITY CHECK

Does the diagram breathe?

If the answer is NO

increase canvas

increase spacing

increase padding

increase margins

reduce crossings

recalculate layout

Only render after all quality checks pass.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

GOAL

The final output should look indistinguishable from a diagram manually designed in Eraser.io.

Users should feel they are looking at a professionally crafted engineering architecture document—not an AI-generated graph.
Diagram Density Rules

Small Project
→ 1200 × 900 canvas

Medium Project
→ 2500 × 1800 canvas

Large Enterprise
→ 4500 × 3000 canvas

Very Large Enterprise
→ Unlimited canvas with auto-expanding sections.

Never compress a large architecture into a small viewport.

Increase the canvas instead of reducing spacing.
Generate diagrams as if they will be printed on an A0 engineeringIf the answer is NO,

continue expanding until the architecture is complete.

The final diagram should resemble a detailed engineering architecture document created by a Principal Software Architect.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CONTAINER POLICY (VERY IMPORTANT)

Containers are OPTIONAL.

Do NOT create containers unless they significantly improve readability.

By default every component should exist as an independent node.

Target

90–95% individual nodes

5–10% containers

Containers should ONLY be used for

• Kubernetes Cluster

• AWS VPC

• External Services

• AI Providers

• Monitoring Stack

Never create

Application Layer

Backend Layer

Business Layer

Infrastructure Layer

Storage Layer

just for organization.

These reduce readability.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Never place unrelated nodes inside one large container.

Instead render

Authentication

Workspace

Notification

Search

AI Gateway

Prompt Builder

LLM Gateway

Redis

BullMQ

Worker

PostgreSQL

Object Storage

Monitoring

as separate independent components.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Maximum container size

6 nodes.

Preferred

3 nodes.

Never exceed

8 nodes.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

If a container contains more than 6 nodes,

split it

or

remove the container completely.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Decision Rule

Before creating a container ask

"Does this container improve readability?"

If NO

remove it.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Prefer

Authentication

↓

Workspace

↓

Notification

↓

Search

↓

Redis

↓

Postgres

↓

Workers

instead of

Backend Services

[ contains 12 services ]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

The final architecture should resemble Eraser.io.

NOT AWS reference architecture.

NOT Microsoft Azure diagrams.

NOT C4 Model.

NOT grouped dashboards.

Think

Independent components connected by clean orthogonal edges.

NOT giant grouped sections.Component Density Rules

95% of nodes should be independent.

Only 5% should be inside containers.

If the renderer creates more than 4 containers in an entire diagram,

it is probably wrong.

Prefer deleting containers over adding more.━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
COMPONENT DECOMPOSITION POLICY (CRITICAL)

The current diagrams are incorrect because major architectural domains are collapsed into a single container.

This hides the real architecture.

DO NOT represent an entire subsystem as one box.

Instead, decompose every subsystem into independent architectural components.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

❌ BAD

Infrastructure

├ PostgreSQL
├ Redis
├ BullMQ
├ Workers
├ Monitoring

This hides the architecture.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ GOOD

PostgreSQL

Redis

BullMQ

Background Workers

Scheduler

Docker

Kubernetes

Cloudflare CDN

Object Storage

Prometheus

Grafana

OpenTelemetry

Sentry

Each should be an independent node connected by meaningful relationships.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Apply the same rule to ALL domains.

❌ BAD

AI Platform

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ GOOD

Prompt Builder

Context Manager

Conversation Manager

LLM Gateway

Model Router

Prompt Templates

Embedding Service

Vector Search

RAG Engine

Streaming Engine

Response Formatter

Token Counter

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

❌ BAD

Database

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ GOOD

PostgreSQL

Users Table

Projects Table

Organizations Table

Sessions Table

Audit Logs

Notifications

API Keys

Billing

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

❌ BAD

Authentication Service

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ GOOD

Login Controller

Register Controller

OAuth Handler

JWT Service

Session Manager

RBAC Engine

Permission Validator

User Repository

Refresh Token Manager

MFA Service

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

❌ BAD

Infrastructure Layer

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ GOOD

Docker

Kubernetes

NGINX

Load Balancer

Cloudflare

Redis

BullMQ

Workers

Cron Scheduler

Secrets Manager

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

GENERAL RULES

Every major subsystem must be expanded into its internal architecture.

Every internal component must become its own node.

Do NOT hide implementation details inside one container.

Parent containers are optional and should only provide visual grouping.

They should never replace individual components.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

TARGET

The final diagram should contain mostly independent nodes connected together.

The architecture should look like a real engineering blueprint where every important service, database, queue, worker, cache, API, and infrastructure component is visible individually.

Do NOT simplify.

Do NOT collapse.

Expand every subsystem into its internal components.EXPANSION RULE

If a node represents more than one technology or responsibility, split it into multiple nodes.

Example

Infrastructure
→ Split into Docker, Kubernetes, NGINX, Cloudflare, Redis, BullMQ, Workers, Monitoring.

AI Platform
→ Split into Prompt Builder, LLM Gateway, RAG Engine, Embedding Service, Vector Search, Model Router.

Database
→ Split into PostgreSQL, Redis, Vector DB, Object Storage.

Never use generic nodes that hide multiple technologies.

Every technology should be visible as its own architectural component.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

OUTPUT FORMAT
Return ONLY JSON. NEVER output x/y coordinates. Output semantic structure only.

CRITICAL INSTRUCTION FOR COLOR CODING: For EVERY node, you MUST assign a "category" field with EXACTLY one of the following values: "frontend" (for UI/features), "backend" (for APIs/services), or "infra" (for databases/cloud/infrastructure). This is required so the system can color them Blue, Yellow, and Green respectively!

CRITICAL INSTRUCTION: For EVERY node, you can use semantic types like "database", "decision", "server", "rectangle", or "icon". Provide a "lucideIcon" field with the EXACT case-sensitive name of a Lucide icon. If no relevant icon is found, leave "lucideIcon" empty (or null) - DO NOT use a generic or irrelevant icon.

{
  "reasoning": "Think step-by-step about the architecture. List all core services, databases, caching layers, external APIs, and monitoring tools. Ensure no component is left isolated. Explain how data flows through the system.",
  "diagramType": "HLD",
  "groups": [
    {
      "id": "group1",
      "title": "Application Layer",
      "category": "backend",
      "parentId": ""
    }
  ],
  "nodes": [
    {
      "id": "node1",
      "title": "Auth API",
      "subtitle": "Handles login",
      "groupId": "group1",
      "type": "icon",
      "lucideIcon": "Shield",
      "category": "backend",
      "technologies": ["Node.js", "Express"]
    }
  ],
  "edges": [
    {
      "source": "node1",
      "target": "node2",
      "label": "Verifies token",
      "protocol": "REST",
      "direction": "directed"
    }
  ]
}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

FINAL OUTPUT

Return ONLY structured JSON.

No markdown.
No explanation.
No comments.
Only a beautiful professional diagram.`;

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Generate architecture diagram elements for: ${prompt}` },
        ],
        temperature: 0.3,
        max_tokens: 8192,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Groq API error:", errText);
      const fallbackElements = generateSmartFallbackDiagram(prompt);
      return NextResponse.json({ elements: fallbackElements, source: "fallback" });
    }

    const data = await response.json();
    const rawContent = data?.choices?.[0]?.message?.content || "";
    const cleanedJson = rawContent.replace(/```json/g, "").replace(/```/g, "").trim();
    let parsedData: any;
    try {
      parsedData = JSON.parse(cleanedJson);
    } catch (e) {
      console.error("JSON parse error:", e);
      return NextResponse.json({ elements: generateSmartFallbackDiagram(prompt), source: "parse-error-fallback" });
    }

    let elements: any[] = [];

    if (parsedData && parsedData.nodes && parsedData.edges) {
      elements = await runLayoutPipeline(parsedData);
    } else if (Array.isArray(parsedData)) {
      elements = parsedData;
    }

    return NextResponse.json({ elements, source: "groq-ai" });

  } catch (error: any) {
    console.error("AI Generation error:", error);
    const fallbackElements = generateSmartFallbackDiagram("System Architecture");
    return NextResponse.json({ elements: fallbackElements, source: "error-fallback" });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MULTI-STAGE LAYOUT PIPELINE
// ═══════════════════════════════════════════════════════════════════════════

const MAX_NODES_PER_ROW = 7;
const MAX_CONTAINER_CHILDREN = 6;
const MAX_ASPECT_RATIO = 2.5;
const MIN_ASPECT_RATIO = 0.4;
const MAX_OPT_PASSES = 8;

const NODE_W = 220;
const NODE_H = 85;
const H_GAP = 160;
const V_GAP = 120;
const CONTAINER_PADDING = 80;

// ─── Stage 0: Semantic Importance ───────────────────────────────────────────
const CRITICAL_KEYWORDS = ["gateway", "auth", "authentication", "database", "redis", "postgres", "openai", "llm", "api"];
const HIGH_KEYWORDS = ["service", "worker", "storage", "backend", "queue", "broker", "kafka", "bullmq"];
const LOW_KEYWORDS = ["dto", "config", "cron", "secret", "log", "audit"];

function getImportance(node: any): number {
  const text = `${node.title} ${node.subtitle || ""} ${(node.technologies || []).join(" ")}`.toLowerCase();
  if (CRITICAL_KEYWORDS.some(k => text.includes(k))) return 3;
  if (HIGH_KEYWORDS.some(k => text.includes(k))) return 2;
  if (LOW_KEYWORDS.some(k => text.includes(k))) return 0;
  return 1;
}

// ─── Stage 1: Graph Validation ──────────────────────────────────────────────
function validateGraph(data: any): any {
  const nodeIds = new Set(data.nodes.map((n: any) => n.id));
  const seen = new Set<string>();
  const nodes = data.nodes.filter((n: any) => {
    if (seen.has(n.id)) return false;
    seen.add(n.id);
    return true;
  });
  const edges = (data.edges || []).filter((e: any) =>
    nodeIds.has(e.source) && nodeIds.has(e.target) && e.source !== e.target
  );
  return { ...data, nodes, edges };
}

// ─── Stage 2 & 3: Hierarchy + Dependency Analysis ───────────────────────────
function computeDepths(nodes: any[], edges: any[]): Map<string, number> {
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  for (const n of nodes) { inDegree.set(n.id, 0); adjacency.set(n.id, []); }
  for (const e of edges) {
    inDegree.set(e.target, (inDegree.get(e.target) || 0) + 1);
    adjacency.get(e.source)!.push(e.target);
  }

  // Kahn's topological sort for depth assignment
  const depths = new Map<string, number>();
  const queue: string[] = [];
  for (const [id, deg] of inDegree) { if (deg === 0) { queue.push(id); depths.set(id, 0); } }
  while (queue.length) {
    const curr = queue.shift()!;
    const currDepth = depths.get(curr) || 0;
    for (const next of (adjacency.get(curr) || [])) {
      const newDepth = currDepth + 1;
      if (!depths.has(next) || depths.get(next)! < newDepth) depths.set(next, newDepth);
      inDegree.set(next, (inDegree.get(next) || 1) - 1);
      if (inDegree.get(next) === 0) queue.push(next);
    }
  }
  // Fallback for cycle nodes
  for (const n of nodes) { if (!depths.has(n.id)) depths.set(n.id, 0); }
  return depths;
}

// ─── Stage 4: Connected Component Detection ──────────────────────────────────
function detectComponents(nodes: any[], edges: any[]): Map<string, number> {
  const adj = new Map<string, Set<string>>();
  for (const n of nodes) adj.set(n.id, new Set());
  for (const e of edges) {
    adj.get(e.source)?.add(e.target);
    adj.get(e.target)?.add(e.source); // undirected for component detection
  }
  const componentId = new Map<string, number>();
  let compIdx = 0;
  for (const n of nodes) {
    if (componentId.has(n.id)) continue;
    const stack = [n.id];
    while (stack.length) {
      const curr = stack.pop()!;
      if (componentId.has(curr)) continue;
      componentId.set(curr, compIdx);
      for (const neighbor of (adj.get(curr) || [])) stack.push(neighbor);
    }
    compIdx++;
  }
  return componentId;
}

// ─── Stage 7 & 8: Container Audit + Layer Balancing ─────────────────────────
function splitOversizedGroups(data: any): any {
  if (!data.groups || data.groups.length === 0) return data;
  const childCount = new Map<string, number>();
  for (const n of data.nodes) {
    if (n.groupId) childCount.set(n.groupId, (childCount.get(n.groupId) || 0) + 1);
  }
  // Remove groups that exceed MAX_CONTAINER_CHILDREN — promote children to root
  const badGroups = new Set<string>();
  for (const g of data.groups) {
    const count = childCount.get(g.id) || 0;
    if (count > MAX_CONTAINER_CHILDREN) badGroups.add(g.id);
  }
  const nodes = data.nodes.map((n: any) =>
    badGroups.has(n.groupId) ? { ...n, groupId: undefined } : n
  );
  const groups = data.groups.filter((g: any) => !badGroups.has(g.id));
  return { ...data, nodes, groups };
}

// ─── Stages 9–12: ELK Orchestration + Quality Evaluation ────────────────────
async function runELKWithOptimization(elkGraph: any, iterationsLeft = MAX_OPT_PASSES): Promise<any> {
  const layouted = await elk.layout(elkGraph);

  // Quality Evaluation
  let maxX = 0, maxY = 0;
  const evalNode = (node: any, ox = 0, oy = 0) => {
    const absX = (node.x || 0) + ox + (node.width || 0);
    const absY = (node.y || 0) + oy + (node.height || 0);
    if (absX > maxX) maxX = absX;
    if (absY > maxY) maxY = absY;
    (node.children || []).forEach((c: any) => evalNode(c, (node.x || 0) + ox, (node.y || 0) + oy));
  };
  (layouted.children || []).forEach((c: any) => evalNode(c));

  const ar = maxY > 0 ? maxX / maxY : 999;

  if (iterationsLeft > 0 && (ar > MAX_ASPECT_RATIO || ar < MIN_ASPECT_RATIO)) {
    // Flip direction and retry
    const newDirection = ar > MAX_ASPECT_RATIO ? "DOWN" : "RIGHT";
    const newSpacingH = ar > MAX_ASPECT_RATIO
      ? String(parseInt(elkGraph.layoutOptions['elk.spacing.nodeNode'] || "200") * 0.8)
      : String(parseInt(elkGraph.layoutOptions['elk.spacing.nodeNode'] || "200") * 1.2);
    const newSpacingV = ar < MIN_ASPECT_RATIO
      ? String(parseInt(elkGraph.layoutOptions['elk.layered.spacing.nodeNodeBetweenLayers'] || "200") * 0.8)
      : elkGraph.layoutOptions['elk.layered.spacing.nodeNodeBetweenLayers'];

    const retryGraph = {
      ...elkGraph,
      layoutOptions: {
        ...elkGraph.layoutOptions,
        'elk.direction': newDirection,
        'elk.spacing.nodeNode': newSpacingH,
        'elk.layered.spacing.nodeNodeBetweenLayers': newSpacingV,
      }
    };
    return runELKWithOptimization(retryGraph, iterationsLeft - 1);
  }

  return layouted;
}

// ─── Stage 11: Magnetic Port Resolution ────────────────────────────────────
// Returns the nearest edge port (center of top/bottom/left/right side) for
// a directed edge.  The caller embeds port data in the generated arrow element.
function resolvePort(
  sourceEl: any, targetEl: any, side: "source" | "target"
): { x: number; y: number } {
  if (!sourceEl || !targetEl) return { x: 0, y: 0 };
  const sc = { x: sourceEl.x + sourceEl.w / 2, y: sourceEl.y + sourceEl.h / 2 };
  const tc = { x: targetEl.x + targetEl.w / 2, y: targetEl.y + targetEl.h / 2 };

  const el = side === "source" ? sourceEl : targetEl;
  const dx = tc.x - sc.x;
  const dy = tc.y - sc.y;

  if (Math.abs(dy) > Math.abs(dx)) {
    // Primarily vertical
    return dy > 0
      ? { x: el.x + el.w / 2, y: side === "source" ? el.y + el.h : el.y }
      : { x: el.x + el.w / 2, y: side === "source" ? el.y : el.y + el.h };
  } else {
    // Primarily horizontal
    return dx > 0
      ? { x: side === "source" ? el.x + el.w : el.x, y: el.y + el.h / 2 }
      : { x: side === "source" ? el.x : el.x + el.w, y: el.y + el.h / 2 };
  }
}

// Helper to compute node dimensions based on shape
function getNodeDimensions(node: any): { w: number; h: number; shape: string } {
  const shape = getNodeShape(node);
  if (shape === "ellipse") return { w: 280, h: 110, shape };
  if (shape === "diamond") return { w: 280, h: 120, shape };
  return { w: 240, h: 90, shape };
}

// Post-Layout Overlap Resolution Engine
function resolveOverlaps(
  placedNodes: { id: string; nodeId: string; x: number; y: number; w: number; h: number; element: any }[]
) {
  const MARGIN_X = 120; // Required clearance between node bounding boxes horizontally
  const MARGIN_Y = 100; // Required clearance between node bounding boxes vertically
  const MAX_ITERATIONS = 30;

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    let hasShift = false;

    for (let i = 0; i < placedNodes.length; i++) {
      for (let j = i + 1; j < placedNodes.length; j++) {
        const a = placedNodes[i];
        const b = placedNodes[j];

        const centerAx = a.x + a.w / 2;
        const centerAy = a.y + a.h / 2;
        const centerBx = b.x + b.w / 2;
        const centerBy = b.y + b.h / 2;

        const overlapX = (a.w / 2 + b.w / 2 + MARGIN_X) - Math.abs(centerAx - centerBx);
        const overlapY = (a.h / 2 + b.h / 2 + MARGIN_Y) - Math.abs(centerAy - centerBy);

        if (overlapX > 0 && overlapY > 0) {
          hasShift = true;
          // Separate along the axis of smaller overlap
          if (overlapY <= overlapX) {
            const shiftY = Math.ceil(overlapY);
            if (centerBy >= centerAy) {
              b.y += shiftY;
            } else {
              a.y += shiftY;
            }
          } else {
            const shiftX = Math.ceil(overlapX);
            if (centerBx >= centerAx) {
              b.x += shiftX;
            } else {
              a.x += shiftX;
            }
          }
        }
      }
    }

    if (!hasShift) break;
  }

  // Update underlying element x, y coordinates
  placedNodes.forEach((pn) => {
    pn.element.x = pn.x;
    pn.element.y = pn.y;
  });
}

// ─── Color & Shape Helpers ──────────────────────────────────────────────────
function getNodeColor(node: any): string {
  if (node.category === "frontend") return "#3B82F6";
  if (node.category === "backend") return "#EAB308";
  if (node.category === "infra") return "#22C55E";
  return "#94A3B8";
}

function getNodeShape(node: any): string {
  if (node.type === "database") return "ellipse";
  if (node.type === "decision") return "diamond";
  if (node.type === "server") return "rectangle";
  return "rectangle";
}

// ═══════════════════════════════════════════════════════════════════════════
// STORY-DRIVEN ARCHITECTURE LAYOUT ENGINE
// ═══════════════════════════════════════════════════════════════════════════

// Architectural Zones for Storytelling
type ZoneType =
  | "CLIENT"
  | "GATEWAY"
  | "AUTH"
  | "CORE"
  | "ASYNC"
  | "EXTERNAL"
  | "AI"
  | "STORAGE"
  | "MONITORING";

function classifyZone(node: any): ZoneType {
  const text = `${node.title || ""} ${node.subtitle || ""} ${(node.technologies || []).join(" ")} ${node.category || ""} ${node.type || ""}`.toLowerCase();

  if (text.includes("prometheus") || text.includes("grafana") || text.includes("sentry") || text.includes("loki") || text.includes("jaeger") || text.includes("opentelemetry") || text.includes("monitoring") || text.includes("observability")) {
    return "MONITORING";
  }
  if (text.includes("stripe") || text.includes("twilio") || text.includes("sendgrid") || text.includes("webhook") || text.includes("external") || text.includes("third-party") || text.includes("3rd party")) {
    return "EXTERNAL";
  }
  if (text.includes("bullmq") || text.includes("worker") || text.includes("queue") || text.includes("kafka") || text.includes("rabbitmq") || text.includes("scheduler") || text.includes("async") || text.includes("event bus")) {
    return "ASYNC";
  }
  if (text.includes("client") || text.includes("user") || text.includes("browser") || text.includes("mobile") || text.includes("react") || text.includes("next.js") || text.includes("frontend") || text.includes("spa") || text.includes("app")) {
    return "CLIENT";
  }
  if (text.includes("gateway") || text.includes("nginx") || text.includes("ingress") || text.includes("load balancer") || text.includes("cloudflare") || text.includes("proxy")) {
    return "GATEWAY";
  }
  if (text.includes("auth") || text.includes("oauth") || text.includes("jwt") || text.includes("session manager") || text.includes("identity") || text.includes("login") || text.includes("rbac")) {
    return "AUTH";
  }
  if (text.includes("openai") || text.includes("claude") || text.includes("gemini") || text.includes("llm") || text.includes("rag") || text.includes("vector") || text.includes("embedding") || text.includes("prompt") || text.includes("ai")) {
    return "AI";
  }
  if (text.includes("database") || text.includes("postgres") || text.includes("redis") || text.includes("mysql") || text.includes("s3") || text.includes("storage") || text.includes("cache") || text.includes("table") || text.includes("repository") || text.includes("bucket")) {
    return "STORAGE";
  }
  return "CORE";
}

// Main Story Layout Engine
async function runLayoutPipeline(rawData: any): Promise<any[]> {
  const sessionId = Math.random().toString(36).substring(2, 9);
  const validated = validateGraph(rawData);
  const cleaned = splitOversizedGroups(validated);

  // 1. Group nodes by Story Zone
  const zoneMap: Record<ZoneType, any[]> = {
    CLIENT: [],
    GATEWAY: [],
    AUTH: [],
    CORE: [],
    ASYNC: [],
    EXTERNAL: [],
    AI: [],
    STORAGE: [],
    MONITORING: [],
  };

  cleaned.nodes.forEach((node: any) => {
    const zone = classifyZone(node);
    node._zone = zone;
    node._importance = getImportance(node);
    zoneMap[zone].push(node);
  });

  // Layout Constants
  const CENTER_X = 750;
  const H_GAP = 140; // Horizontal gap between node borders
  const V_GAP = 140; // Vertical gap between row borders
  const MAX_PER_ROW = 3;

  let currentY = 100;

  const nodePositions: Record<string, { x: number; y: number; w: number; h: number }> = {};
  const elements: any[] = [];
  const placedNodeList: { id: string; nodeId: string; x: number; y: number; w: number; h: number; element: any }[] = [];

  // Helper to place nodes in wrapped rows (max MAX_PER_ROW per row)
  const placeNodeRows = (nodesList: any[], anchorX = CENTER_X) => {
    if (nodesList.length === 0) return;

    // Chunk nodes into rows of MAX_PER_ROW
    for (let i = 0; i < nodesList.length; i += MAX_PER_ROW) {
      const chunk = nodesList.slice(i, i + MAX_PER_ROW);

      // Compute width & height of each node in chunk
      const chunkDims = chunk.map((n) => getNodeDimensions(n));
      const rowWidth = chunkDims.reduce((acc, d) => acc + d.w, 0) + (chunk.length - 1) * H_GAP;
      const maxRowH = Math.max(...chunkDims.map((d) => d.h));

      let cursorX = anchorX - rowWidth / 2;

      chunk.forEach((n: any, idx: number) => {
        const { w, h, shape } = chunkDims[idx];
        const color = getNodeColor(n);
        const nodeY = currentY + (maxRowH - h) / 2; // Vertically center in row

        const uid = `${n.id}_${sessionId}`;
        const nodeObj = {
          id: uid,
          type: shape,
          nodeType: n.type,
          lucideIcon: n.lucideIcon || null,
          title: n.title,
          subtitle: n.subtitle,
          text: n.title ? (n.subtitle ? `${n.title}\n${n.subtitle}` : n.title) : (n.id || "Component"),
          x: cursorX,
          y: nodeY,
          width: w,
          height: h,
          color,
          fillColor: "transparent",
          strokeColor: color,
          strokeWidth: 2,
          _importance: n._importance || 1,
          _disclosureLevel: (n._importance || 1) >= 3 ? 0 : (n._importance || 1) === 2 ? 1 : 2,
          _technologies: n.technologies || [],
          _zIndex: 1,
        };

        elements.push(nodeObj);
        const pRecord = { id: uid, nodeId: n.id, x: cursorX, y: nodeY, w, h, element: nodeObj };
        placedNodeList.push(pRecord);
        nodePositions[n.id] = pRecord;
        nodePositions[uid] = pRecord;

        cursorX += w + H_GAP;
      });

      currentY += maxRowH + V_GAP;
    }
  };

  // Stage 1: Clients (Top Center)
  if (zoneMap.CLIENT.length > 0) {
    placeNodeRows(zoneMap.CLIENT, CENTER_X);
  }

  // Stage 2: Gateways (Center)
  if (zoneMap.GATEWAY.length > 0) {
    placeNodeRows(zoneMap.GATEWAY, CENTER_X);
  }

  // Stage 3: Auth & Core Services
  const mainCoreNodes = [...zoneMap.AUTH, ...zoneMap.CORE];
  const asyncNodes = zoneMap.ASYNC;
  const externalNodes = zoneMap.EXTERNAL;

  let leftBranchWidth = 0;
  if (asyncNodes.length > 0) {
    const dims = asyncNodes.slice(0, MAX_PER_ROW).map((n) => getNodeDimensions(n));
    leftBranchWidth = dims.reduce((acc, d) => acc + d.w, 0) + (dims.length - 1) * H_GAP;
  }
  let rightBranchWidth = 0;
  if (externalNodes.length > 0) {
    const dims = externalNodes.slice(0, MAX_PER_ROW).map((n) => getNodeDimensions(n));
    rightBranchWidth = dims.reduce((acc, d) => acc + d.w, 0) + (dims.length - 1) * H_GAP;
  }

  const spineDims = mainCoreNodes.slice(0, MAX_PER_ROW).map((n) => getNodeDimensions(n));
  const spineWidth = spineDims.length > 0
    ? spineDims.reduce((acc, d) => acc + d.w, 0) + (spineDims.length - 1) * H_GAP
    : 240;

  const startCoreY = currentY;

  // Place Core Spine
  if (mainCoreNodes.length > 0) {
    placeNodeRows(mainCoreNodes, CENTER_X);
  }

  // Place Async (Left Branch) with non-overlapping lateral offset
  if (asyncNodes.length > 0) {
    const asyncAnchorX = CENTER_X - Math.max(540, spineWidth / 2 + leftBranchWidth / 2 + H_GAP + 60);
    const prevY = currentY;
    currentY = startCoreY;
    placeNodeRows(asyncNodes, asyncAnchorX);
    currentY = Math.max(currentY, prevY);
  }

  // Place External (Right Branch) with non-overlapping lateral offset
  if (externalNodes.length > 0) {
    const externalAnchorX = CENTER_X + Math.max(540, spineWidth / 2 + rightBranchWidth / 2 + H_GAP + 60);
    const prevY = currentY;
    currentY = startCoreY;
    placeNodeRows(externalNodes, externalAnchorX);
    currentY = Math.max(currentY, prevY);
  }

  // Stage 4: AI Platform & Intelligence Layer
  if (zoneMap.AI.length > 0) {
    placeNodeRows(zoneMap.AI, CENTER_X);
  }

  // Stage 5: Storage & Persistence Layer
  if (zoneMap.STORAGE.length > 0) {
    placeNodeRows(zoneMap.STORAGE, CENTER_X);
  }

  // Stage 6: Observability & Monitoring
  if (zoneMap.MONITORING.length > 0) {
    placeNodeRows(zoneMap.MONITORING, CENTER_X + 480);
  }

  // ─── Post-Layout Overlap Resolution Pass ─────────────────────────────────
  resolveOverlaps(placedNodeList);

  // Update nodePositions map after overlap resolution shifts
  placedNodeList.forEach((pn) => {
    nodePositions[pn.nodeId] = { x: pn.x, y: pn.y, w: pn.w, h: pn.h };
    nodePositions[pn.id] = { x: pn.x, y: pn.y, w: pn.w, h: pn.h };
  });

  // 3. Process Container / Group Frames
  if (cleaned.groups && cleaned.groups.length > 0) {
    cleaned.groups.forEach((g: any) => {
      const groupNodes = cleaned.nodes.filter((n: any) => n.groupId === g.id);
      if (groupNodes.length > 0 && groupNodes.length <= MAX_CONTAINER_CHILDREN) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        groupNodes.forEach((n: any) => {
          const pos = nodePositions[n.id];
          if (pos) {
            minX = Math.min(minX, pos.x);
            minY = Math.min(minY, pos.y);
            maxX = Math.max(maxX, pos.x + pos.w);
            maxY = Math.max(maxY, pos.y + pos.h);
          }
        });

        if (minX !== Infinity) {
          const cat = g.category || "infra";
          const strokeColor = cat === "frontend" ? "#3B82F6" : cat === "backend" ? "#EAB308" : "#22C55E";
          elements.push({
            id: `${g.id}_${sessionId}`,
            type: "frame",
            text: g.title,
            x: minX - 50,
            y: minY - 60,
            width: maxX - minX + 100,
            height: maxY - minY + 110,
            color: "#FFFFFF",
            fillColor: "rgba(255, 255, 255, 0.02)",
            strokeColor,
            strokeWidth: 1.5,
            _zIndex: 0,
          });
        }
      }
    });
  }

  // 4. Smart Edge Routing & Magnetic Port Resolution
  cleaned.edges.forEach((e: any, idx: number) => {
    const srcPos = nodePositions[e.source];
    const tgtPos = nodePositions[e.target];
    if (srcPos && tgtPos) {
      const srcPort = resolvePort(srcPos, tgtPos, "source");
      const tgtPort = resolvePort(srcPos, tgtPos, "target");

      elements.push({
        id: `arr-story-${idx}-${sessionId}`,
        type: "arrow",
        text: e.label || e.protocol || "",
        startNodeId: `${e.source}_${sessionId}`,
        endNodeId: `${e.target}_${sessionId}`,
        startPort: srcPort,
        endPort: tgtPort,
        color: e.protocol === "Event" || e.protocol === "Publish" ? "#F59E0B"
             : e.protocol === "gRPC" ? "#A78BFA"
             : e.protocol === "Database" || e.protocol === "Cache" ? "#22C55E"
             : "#6B7280",
        _zIndex: 2,
      });
    }
  });

  return elements;
}


function generateSmartFallbackDiagram(prompt: string) {
  return [
    { id: "el-1", type: "rectangle", x: 100, y: 200, width: 220, height: 90, text: "React Frontend Client", color: "#3B82F6" },
    { id: "el-2", type: "diamond", x: 460, y: 185, width: 220, height: 110, text: "API Gateway / NGINX", color: "#7C3AED" },
    { id: "el-3", type: "rectangle", x: 820, y: 100, width: 220, height: 90, text: "Auth & Identity Service", color: "#10B981" },
    { id: "el-4", type: "rectangle", x: 820, y: 270, width: 220, height: 90, text: "Core Backend Service", color: "#10B981" },
    { id: "el-5", type: "ellipse", x: 1180, y: 95, width: 240, height: 100, text: "Redis Session Cache", color: "#F59E0B" },
    { id: "el-6", type: "ellipse", x: 1180, y: 265, width: 240, height: 100, text: "PostgreSQL Master DB", color: "#EF4444" },
    { id: "el-7", type: "sticky", x: 460, y: 350, width: 220, height: 100, text: `⚡ Generated for: ${prompt}`, color: "#7C3AED" },
    { id: "el-arr-1", type: "arrow", startNodeId: "el-1", endNodeId: "el-2", color: "#808080" },
    { id: "el-arr-2", type: "arrow", startNodeId: "el-2", endNodeId: "el-3", color: "#808080" },
    { id: "el-arr-3", type: "arrow", startNodeId: "el-2", endNodeId: "el-4", color: "#808080" },
  ];
}
