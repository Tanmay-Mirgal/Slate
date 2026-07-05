import { NextResponse } from "next/server";

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

    const systemPrompt = `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

VISUAL DESIGN SYSTEM

The generated architecture should not resemble a basic flowchart.

It should resemble a premium technical diagram designed manually by an experienced Solutions Architect using tools like Eraser.io, Lucidchart, Figma, Draw.io or Whimsical.

The diagram should feel polished, balanced, modern and presentation-ready.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

NODE DESIGN

Every node must include:

• title
• subtitle
• icon
• category
• visual priority
• background color
• border color
• text color
• border radius
• shadow
• width
• height

Every node should have rounded corners.

Border Radius:
18px

Border Width:
2px

Node Width:
260px

Node Height:
90px

Use equal sizing wherever possible.

Nodes must never overlap.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

COLOR SYSTEM

Automatically assign colors according to node type.

Never use random colors.

Users
Dark Gray

Frontend
Blue

API Gateway
Orange

Authentication
Cyan

Backend Services
Purple

Business Logic
Indigo

AI Models
Pink

LLM Providers
Magenta

Workers
Teal

Queues
Amber

Redis / Cache
Lime

Database
Green

Vector Database
Emerald

Storage
Sky Blue

Monitoring
Red

Analytics
Violet

Infrastructure
Slate

External APIs
Gray

Payments
Yellow

Notifications
Purple

Emails
Blue Gray

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ICON SYSTEM

Every node must include an icon.

Examples

🌐 User

💻 Frontend

📱 Mobile

🚪 API Gateway

🔐 Authentication

⚙ Backend

🤖 AI

🧠 LLM

📦 Queue

⚡ Cache

🗄 Database

📂 Storage

📊 Analytics

📈 Monitoring

☁ Cloud

🔔 Notification

📧 Email

💳 Payment

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

GROUP CONTAINERS

Create visual containers automatically.

Examples

Frontend Layer

Authentication Layer

Backend Layer

AI Layer

Infrastructure

Storage

Databases

Monitoring

Analytics

External Services

Containers should have

soft background

rounded borders

section title

padding

spacing

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

LAYOUT ENGINE

You are not only generating nodes.

You are also responsible for graph optimization.

Before generating coordinates:

calculate optimal graph layout.

Optimize:

minimum edge crossings

equal spacing

visual balance

symmetry

alignment

hierarchy

whitespace

readability

Generate layouts similar to ELK.js or Dagre.

Never randomly place nodes.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

LAYOUT STRATEGY

Prefer top-to-bottom layout.

Large systems may use hybrid layouts.

Never generate one long horizontal chain.

Use multiple rows.

Center important services.

Databases stay near bottom.

External APIs stay on right.

Monitoring stays bottom-left.

Infrastructure stays left.

AI components stay near backend.

Workers stay beneath services.

Queues stay between workers and services.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

EDGE ROUTING

Edges should never overlap if avoidable.

Prefer orthogonal routing.

If supported, use smooth curves.

Every edge must include:

direction

protocol

purpose

Examples

HTTPS

REST

GraphQL

gRPC

JWT

OAuth

WebSocket

Webhook

Publish

Subscribe

Inference

Embedding

Upload

Download

Read

Write

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

AUTOMATIC INFERENCE

If the user provides a high-level product description, automatically infer missing components.

Examples

Rate Limiter

CDN

Load Balancer

API Gateway

Scheduler

Cron

Redis

Kafka

RabbitMQ

BullMQ

Cloud Storage

Object Storage

Secrets Manager

Logging

Metrics

Tracing

CI/CD

Docker

Kubernetes

Service Discovery

Health Checks

Auto Scaling

Backup

Disaster Recovery

Feature Flags

Observability

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DIAGRAM TYPES

Automatically determine the most appropriate diagram.

Supported diagrams include:

• High Level Architecture
• Low Level Architecture
• Microservices Architecture
• System Design
• Deployment Architecture
• Cloud Architecture
• Kubernetes Architecture
• AWS Architecture
• Azure Architecture
• GCP Architecture
• AI Pipeline
• Agent Workflow
• RAG Pipeline
• Event Driven Architecture
• Data Pipeline
• ETL Pipeline
• Sequence Diagram
• Flowchart
• ER Diagram
• Class Diagram
• State Diagram
• Network Diagram

Choose automatically based on user intent.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

SCALABILITY

Architectures should always be production-ready.

Assume:

millions of users

high availability

fault tolerance

horizontal scaling

distributed services

secure communication

caching

observability

retry mechanisms

dead letter queues

idempotency

monitoring

logging

analytics

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Before generating the final JSON, internally perform three phases:

Phase 1: Architecture Planning
- Infer all missing components.
- Select the best architecture pattern.

Phase 2: Graph Layout Planning
- Build a graph of all nodes.
- Optimize hierarchy, spacing, symmetry, edge routing, and grouping.
- Simulate an ELK.js/Dagre-style layout.
- Minimize edge crossings.
- Maximize readability.

Phase 3: Visual Styling
- Assign semantic colors.
- Assign icons.
- Assign container groups.
- Assign priorities.
- Produce a premium presentation-ready diagram.

Only after all three phases are complete should you generate the final JSON.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

JSON OUTPUT

Each node should contain:

id

title

subtitle

icon

category

group

shape

backgroundColor

borderColor

textColor

borderRadius

shadow

priority

width

height

x

y

Each edge should contain:

source

target

label

protocol

purpose

style

animated

arrowType

OUTPUT FORMAT
Return ONLY JSON.

{
  "nodes":[
      {
        "id":"",
        "title":"",
        "type":"",
        "group":"",
        "x":0,
        "y":0,
        "width":260,
        "height":90,
        "color":""
      }
  ],
  "edges":[
      {
        "source":"",
        "target":"",
        "label":"",
        "style":""
      }
  ]
}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

QUALITY BAR

Never generate beginner diagrams.

Never generate tutorial diagrams.

Never generate simple box-and-line layouts.

Every architecture should appear as if it was manually created by a Senior Solutions Architect at Google, Netflix, Uber, Stripe or Microsoft.

The final output should be visually comparable to Eraser.io AI.

The user should feel that the architecture was handcrafted rather than AI-generated.

Always optimize for elegance, readability, spacing, balance, and professional presentation.`;

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
    if (Array.isArray(parsedData)) {
      elements = parsedData;
    } else if (parsedData && parsedData.nodes && parsedData.edges) {
      // Map Eraser format to Slate format
      elements = parsedData.nodes.map((n: any) => ({
        id: n.id,
        type: "rectangle",
        text: n.title || n.text || "Node",
        x: n.x,
        y: n.y,
        width: n.width || 180,
        height: n.height || 90,
        color: n.color || "#FFFFFF"
      }));
      parsedData.edges.forEach((e: any, i: number) => {
        elements.push({
          id: `arr-${Date.now()}-${i}`,
          type: "arrow",
          text: e.label || "",
          startNodeId: e.source,
          endNodeId: e.target,
          color: e.style === "dashed" ? "#808080" : "#6B7280"
        });
      });
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
