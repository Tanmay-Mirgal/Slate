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

    const systemPrompt = `You are a Staff Software & Cloud Systems Architect. Your job is to parse the user's system architecture or flowchart requirements and output a clean 2D whiteboard diagram structure as a JSON array of canvas elements.

Respond ONLY with a valid JSON array of objects. NO Markdown code block backticks (\`\`\`json), NO extra text, ONLY the JSON array.

Canvas Element Schema:
{
  "id": string (unique identifier e.g. "el-1"),
  "type": "rectangle" | "ellipse" | "diamond" | "sticky" | "text" | "arrow",
  "x": number (horizontal coordinate between 100 and 1200 - for nodes only),
  "y": number (vertical coordinate between 100 and 800 - for nodes only),
  "width": number (between 160 and 220 - for nodes only),
  "height": number (between 80 and 110 - for nodes only),
  "startNodeId": string (required IF type is "arrow", the ID of the node it starts from),
  "endNodeId": string (required IF type is "arrow", the ID of the node it points to),
  "text": string (short clean name e.g. "React Web Client", "API Gateway" or label for arrows),
  "color": string (hex color code: "#7C3AED" for primary/gateways, "#10B981" for services, "#F59E0B" for caches/queues, "#EF4444" for databases, "#3B82F6" for clients, or for arrow lines)
}

Layout Guidelines:
- Place 4 to 8 nodes arranged cleanly in a multi-tier pipeline (e.g. Tier 1 Clients at x: 100, Tier 2 Gateways at x: 380, Tier 3 Services at x: 680, Tier 4 Databases at x: 980).
- If the user asks for a flowchart, connect the nodes logically using "arrow" elements. Provide "startNodeId" and "endNodeId" for every arrow.
- Make component labels clear and realistic for modern tech stacks.`;

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
    const elements = JSON.parse(cleanedJson);

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
