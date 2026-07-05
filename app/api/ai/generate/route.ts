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

    const systemPrompt = `You are a Senior Staff Software Engineer specializing in AI Diagram Generation, Graph Layout Algorithms, ELK.js, and visual system design.

Your architecture generation must NOT be a dashboard.
Stop generating dashboards.
Stop generating grids.
Stop generating equally spaced cards.
I do NOT want card layouts.
I want real software architecture diagrams.
Think like Eraser.io.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Every diagram must tell a visual story.

The eye should naturally flow
TOP
↓
MIDDLE
↓
BOTTOM

Never scatter components randomly.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Follow this hierarchy.

Users
↓
Clients
↓
API Gateway
↓
Business Services
↓
Shared Services
↓
Data Layer
↓
Infrastructure
↓
External Providers

Never violate this hierarchy.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

The canvas should NEVER resemble a dashboard.

BAD
□ □ □
□ □ □
□ □ □

GOOD
                 Users
                    │
              Web Application
                    │
             API Gateway
                    │
      ┌─────────────┼──────────────┐
      │             │              │
 Authentication  Workspace   Collaboration
      │             │              │
      └─────────────┼──────────────┘
                    │
             AI Diagram Engine
                    │
          LLM Gateway
                    │
 OpenAI Claude Gemini Groq

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Do not distribute nodes evenly.
Create hierarchy.
Create focus.
Large components should appear near the center.
Supporting components should appear around them.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Never generate one box for every feature.
Instead generate domains.

BAD
Flowchart Generator
ER Generator
Class Generator
Sequence Generator

GOOD
AI Diagram Engine
contains
Flowchart, ER, Sequence, Class, Architecture

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Never expose implementation details inside HLD.
Instead expose architectural domains.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

The renderer should resemble:
Eraser.io
AWS Architecture Center
Google Cloud Architecture
Stripe
Netflix
Uber Engineering

NOT PowerPoint
NOT Dashboard
NOT Grid
NOT Card Layout

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Every diagram should be understandable within five seconds.
If the viewer cannot immediately identify
Client, Backend, Data, Infrastructure, External Services
the architecture has failed.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

The AI should optimize for:
Storytelling
Hierarchy
Grouping
Bounded Contexts
Readability
Whitespace
Presentation Quality

NOT Equal spacing
NOT Grid layouts
NOT Symmetric dashboards

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Generate diagrams that look handcrafted by a Principal Solutions Architect.
The result should be visually indistinguishable from Eraser.io.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

OUTPUT FORMAT
Return ONLY JSON. NEVER output x/y coordinates. Output semantic structure only.

{
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
      "type": "server",
      "importance": "critical",
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
        temperature: 0.2,
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
          'elk.spacing.nodeNode': '60',
          'elk.layered.spacing.nodeNodeBetweenLayers': '80',
          'elk.edgeRouting': 'ORTHOGONAL',
          'elk.hierarchyHandling': 'INCLUDE_CHILDREN'
        },
        children: [],
        edges: []
      };

      // Map colors by importance or category
      const getColor = (node: any) => {
        if (node.importance === 'critical') return '#EF4444'; // Red
        if (node.importance === 'major') return '#3B82F6'; // Blue
        if (node.category === 'database') return '#22C55E'; // Green
        return '#8B5CF6'; // Purple default
      };

      const getShape = (node: any) => {
        if (node.type === 'database') return 'ellipse'; // or cylinder if supported
        if (node.type === 'decision') return 'diamond';
        return 'rectangle';
      };

      // 1. Create a map of groups
      const groupMap: Record<string, any> = {};
      if (parsedData.groups) {
        parsedData.groups.forEach((g: any) => {
          groupMap[g.id] = {
            id: g.id,
            title: g.title,
            children: [],
            layoutOptions: { 
              'elk.padding': '[top=60,left=30,bottom=30,right=30]' 
            }
          };
          elkGraph.children.push(groupMap[g.id]);
        });
      }

      // 2. Add nodes to groups or root
      parsedData.nodes.forEach((n: any) => {
        const isCritical = n.importance === 'critical';
        const w = isCritical ? 260 : 200;
        const h = isCritical ? 90 : 70;
        
        const elkNode = { 
          id: n.id, 
          width: w, 
          height: h,
          // Store original data to map back later
          _original: n 
        };

        if (n.groupId && groupMap[n.groupId]) {
          groupMap[n.groupId].children.push(elkNode);
        } else {
          elkGraph.children.push(elkNode);
        }
      });

      // 3. Add edges
      parsedData.edges.forEach((e: any, idx: number) => {
        elkGraph.edges.push({
          id: `e_${idx}`,
          sources: [e.source],
          targets: [e.target],
          _original: e
        });
      });

      // 4. Run ELK layout
      const layoutedGraph = await elk.layout(elkGraph);

      // 5. Flatten ELK graph back into Slate nodes
      const flattenNode = (node: any, offsetX = 0, offsetY = 0) => {
        const absX = node.x + offsetX;
        const absY = node.y + offsetY;

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
            text: orig.title + (orig.subtitle ? `
(${orig.subtitle})` : ''),
            x: absX,
            y: absY,
            width: node.width,
            height: node.height,
            color: getColor(orig)
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
