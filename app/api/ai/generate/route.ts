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

    const systemPrompt = `You are a Principal Cloud Solutions Architect at a top-tier tech company.
Your job is to generate extremely detailed, professional, and visually stunning architecture diagrams.

CRITICAL DIRECTIVE ON DETAIL:
You MUST generate EXTREMELY DETAILED architectures. Do NOT create simple, high-level, or abstract diagrams. Every single minute detail must be included. 
Regardless of what diagram the user requests, you MUST include all necessary micro-components, sub-services, caching layers, message queues, load balancers, API gateways, security groups, workers, CDNs, and database read/write replicas. 
Take your time to think exhaustively about the system. The output MUST look like it was rigorously designed by a Principal Architect for a highly scalable, enterprise-grade production system.
You MUST generate a MINIMUM of 15-25 nodes in your output. Break down services into smaller microservices, databases into read/write replicas, and add caches, message brokers (Kafka/RabbitMQ), workers, and CDNs where applicable. Do not give me a 5-node summary.

You output structured JSON that represents nodes, edges, and grouping containers.

The diagram should be suitable for engineering documentation, architecture reviews, investor presentations and technical design documents.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CURRENT PROBLEM

The current diagrams look like grids of cards.

Nodes overlap.

Connections overlap.

Everything feels compressed.

Containers are too small.

The diagram does not breathe.

It looks AI generated.

This is NOT acceptable.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

NEW OBJECTIVE

Generate diagrams that are visually comparable to

• Eraser.io
• Lucidchart
• Whimsical
• Miro
• Microsoft Visio
• AWS Architecture Center

NOT dashboards.

NOT grids.

NOT wireframes.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CANVAS

The canvas should automatically expand.

Do NOT try to fit everything inside one small screen.

The canvas should become larger whenever necessary.

Allow thousands of pixels of width and height.

Large enterprise systems should naturally occupy large canvases.

Whitespace is GOOD.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

SPACING

This is the highest priority.

Every node should have generous spacing.

Every container should have generous padding.

Every layer should have generous margins.

There should be enough empty space so that

- labels never overlap
- edges never overlap
- users never need to guess where something belongs

Optimize readability instead of compactness.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

LAYERS

Always organize diagrams into architectural layers.

Example

Users

↓

Client Applications

↓

API Gateway

↓

Application Services

↓

Business Services

↓

AI Platform

↓

Data Layer

↓

Infrastructure

↓

External Providers

↓

Monitoring

Every layer should have a large visual separation.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CONTAINERS

Create professional containers.

Each container should include

• Title

• Optional subtitle

• Soft background

• Rounded corners

• Padding

• Margin

• Border

Every node belongs to exactly one container.

NO FLOATING NODES. Every single node (including infrastructure, cloud services, external providers, and monitoring) MUST be logically connected to the main application or backend via an edge. If a component is idle or disconnected, do not generate it. Ensure all components have at least one incoming or outgoing edge.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

NODES

Every node should contain

• Icon

• Title

• Subtitle

• Technology

• Category

• Description

Icons must match the technology.

Examples

PostgreSQL

Redis

Kafka

Docker

Kubernetes

AWS

OpenAI

Claude

Gemini

Cloudflare

Stripe

GitHub

Prometheus

Grafana

Never display generic icons.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

NODE SIZES

Nodes should automatically resize according to their content.

Long names should wrap.

Never clip text.

Never overflow.

Never overlap.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

TEXT

Typography must be documentation quality.

Section Titles

Large

Bold

Node Titles

Medium

Bold

Node Description

Small

Readable

Connection Labels

Small

Subtle

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

EDGES

Edges should

Avoid crossings

Avoid overlaps

Use orthogonal routing

Have arrow heads

Contain protocol labels

Contain operation labels

Examples

REST

HTTPS

gRPC

Publish

Subscribe

Read

Write

Webhook

JWT

OAuth

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

AUTO LAYOUT

Never position nodes manually.

Generate a semantic graph first.

Then use a graph layout engine.

The renderer should calculate

x

y

routing

spacing

container sizes

layer spacing

Do NOT ask the LLM to calculate coordinates.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

HIERARCHY

Large systems should naturally become large diagrams.

Never compress the architecture.

Instead

Increase whitespace

Increase canvas

Increase spacing

Increase readability

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DETAIL LEVELS

Support multiple detail levels.

High Level Architecture

Only domains

Medium Detail

Domains + Services

Low Level Design

Domains + Services + Internal Components

Users should be able to zoom into deeper levels.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

VISUAL STYLE

The diagram should resemble engineering documentation.

It should never resemble a dashboard.

It should never resemble a PowerPoint slide.

It should never resemble a collection of cards.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

FINAL QUALITY CHECK

Before rendering ask

Can every node be read without zooming?

Do containers have enough spacing?

Can a CTO understand the architecture within five seconds?

Do the connections feel natural?

Are labels readable?

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
Generate diagrams as if they will be printed on an A0 engineering poster.

Optimize for clarity, documentation quality, and long-term maintainability—not for fitting everything into one screen.

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
    let parsedData;
    try {
      parsedData = JSON.parse(cleanedJson);
    } catch (e) {
      console.error("JSON parse error:", e);
      return NextResponse.json({ elements: generateSmartFallbackDiagram(prompt), source: "parse-error-fallback" });
    }


    let elements: any[] = [];

    if (parsedData && parsedData.nodes && parsedData.edges) {
      // It's the new Semantic format! We must build the ELK graph.
      const elkGraph: any = {
        id: "root",
        layoutOptions: { 
          'elk.algorithm': 'layered', 
          'elk.direction': parsedData.diagramType === 'ER' ? 'RIGHT' : 'DOWN',
          'elk.spacing.nodeNode': '200',
          'elk.layered.spacing.nodeNodeBetweenLayers': '240',
          'elk.spacing.edgeNode': '60',
          'elk.spacing.edgeEdge': '60',
          'elk.edgeRouting': 'ORTHOGONAL',
          'elk.hierarchyHandling': 'INCLUDE_CHILDREN'
        },
        children: [],
        edges: []
      };

      // Map colors by category as requested by the user
      const getColor = (node: any) => {
        if (node.category === 'frontend') return '#3B82F6'; // Blue
        if (node.category === 'backend') return '#EAB308'; // Yellow
        if (node.category === 'infra') return '#22C55E'; // Green
        return '#FFFFFF'; // White default fallback
      };

      const getGroupStrokeColor = (category: string) => {
        if (category === 'frontend') return '#3B82F6';
        if (category === 'backend') return '#EAB308';
        if (category === 'infra') return '#22C55E';
        return '#4B5563';
      };

      const getShape = (node: any) => {
        if (node.type === 'database') return 'circle';
        if (node.type === 'decision') return 'diamond';
        return 'rectangle';
      };

      // 1. Create a map of groups
      const sessionId = Math.random().toString(36).substring(2, 9);
      const groupMap: Record<string, any> = {};
      if (parsedData.groups) {
        parsedData.groups.forEach((g: any) => {
          const uId = `${g.id}_${sessionId}`;
          groupMap[uId] = {
            id: uId,
            title: g.title,
            children: [],
            layoutOptions: { 
              'elk.padding': '[top=100,left=80,bottom=80,right=80]' 
            }
          };
          elkGraph.children.push(groupMap[uId]);
        });
      }

      // 2. Add nodes to groups or root
      parsedData.nodes.forEach((n: any) => {
        const isCritical = n.importance === 'critical';
        const shape = getShape(n);
        
        let w = isCritical ? 260 : 220;
        let h = isCritical ? 100 : 85;
        
        // Ellipses and diamonds need more bounding box area to fit the same content
        if (shape === 'ellipse') {
          w += 40;
          h += 40;
        } else if (shape === 'diamond') {
          w += 60;
          h += 60;
        }
        
        const uId = `${n.id}_${sessionId}`;
        const uGroupId = n.groupId ? `${n.groupId}_${sessionId}` : null;
        
        const elkNode = { 
          id: uId, 
          width: w, 
          height: h,
          // Store original data to map back later
          _original: n 
        };

        if (uGroupId && groupMap[uGroupId]) {
          groupMap[uGroupId].children.push(elkNode);
        } else {
          elkGraph.children.push(elkNode);
        }
      });

      // 3. Add edges
      parsedData.edges.forEach((e: any, idx: number) => {
        elkGraph.edges.push({
          id: `e_${idx}_${sessionId}`,
          sources: [`${e.source}_${sessionId}`],
          targets: [`${e.target}_${sessionId}`],
          _original: e
        });
      });

      // 4. Run ELK layout
      const layoutedGraph = await elk.layout(elkGraph);

      // 5. Flatten ELK graph back into Slate nodes
      const flattenNode = (node: any, offsetX = 0, offsetY = 0) => {
        const absX = (node.x || 0) + offsetX;
        const absY = (node.y || 0) + offsetY;

        if (node.children && node.children.length > 0) {
          // This is a group container. Render background rectangle, then a text node for the title at the top.
          elements.push({
            id: node.id + "_bg",
            type: "rectangle",
            text: "",
            x: absX,
            y: absY,
            width: node.width,
            height: node.height,
            color: "#1E293B", // Dark container background
            fillColor: "#0F172A",
            strokeColor: "#334155",
            strokeWidth: 2
          });
          
          elements.push({
            id: node.id + "_title",
            type: "text",
            text: node.title || node.id,
            x: absX + 20,
            y: absY + 20,
            width: 200,
            height: 30,
            color: "#FFFFFF",
            fillColor: "transparent",
            strokeColor: "#FFFFFF",
            strokeWidth: 1
          });
          
          node.children.forEach((child: any) => flattenNode(child, absX, absY));
        } else if (node._original) {
          // Normal node
          const orig = node._original;
          elements.push({
            id: node.id,
            type: getShape(orig),
            nodeType: orig.type,
            lucideIcon: orig.lucideIcon,
            text: orig.title ? (orig.title + (orig.subtitle ? `\n(${orig.subtitle})` : '')) : (orig.name || orig.id || "Component Node"),
            x: absX,
            y: absY,
            width: node.width,
            height: node.height,
            color: getColor(orig),
            fillColor: "transparent",
            strokeColor: getColor(orig),
            strokeWidth: 2
          });
        }
      };

      // Flatten all top-level children
      layoutedGraph.children?.forEach((child: any) => flattenNode(child));

      // 6. Map Edges
      layoutedGraph.edges?.forEach((edge: any) => {
        if (edge.sections && edge.sections.length > 0) {
          // We can use the start/end/bend points from ELK, or just let Slate do direct connections.
          // For now, let Slate handle direct arrow drawing between nodes, 
          // but maybe in the future we can use edge.sections for exact orthogonal paths.
          const orig = edge._original || {};
          elements.push({
            id: `arr-${Date.now()}-${Math.random()}`,
            type: "arrow",
            text: orig.label || "",
            startNodeId: edge.sources[0],
            endNodeId: edge.targets[0],
            color: orig.protocol === "Event" ? "#F59E0B" : "#9CA3AF"
          });
        }
      });
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

function generateSmartFallbackDiagram(prompt: string) {
  return [
    { id: "el-1", type: "rectangle", x: 100, y: 200, width: 190, height: 90, text: "React Frontend Client", color: "#3B82F6" },
    { id: "el-2", type: "diamond", x: 380, y: 195, width: 160, height: 100, text: "API Gateway / NGINX", color: "#7C3AED" },
    { id: "el-3", type: "rectangle", x: 640, y: 120, width: 190, height: 90, text: "Auth & Identity Service", color: "#10B981" },
    { id: "el-4", type: "rectangle", x: 640, y: 280, width: 190, height: 90, text: "Core Backend Service", color: "#10B981" },
    { id: "el-5", type: "ellipse", x: 920, y: 120, width: 170, height: 90, text: "Redis Session Cache", color: "#F59E0B" },
    { id: "el-6", type: "ellipse", x: 920, y: 280, width: 170, height: 90, text: "PostgreSQL Master DB", color: "#EF4444" },
    { id: "el-7", type: "sticky", x: 380, y: 350, width: 160, height: 100, text: `⚡ Generated for: ${prompt}`, color: "#7C3AED" },
    { id: "el-arr-1", type: "arrow", startNodeId: "el-1", endNodeId: "el-2", color: "#808080" },
    { id: "el-arr-2", type: "arrow", startNodeId: "el-2", endNodeId: "el-3", color: "#808080" },
    { id: "el-arr-3", type: "arrow", startNodeId: "el-2", endNodeId: "el-4", color: "#808080" },
  ];
}
