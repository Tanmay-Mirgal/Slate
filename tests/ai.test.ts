import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractJson } from "@/lib/ai/json";
import { generateGraph } from "@/lib/ai/generate";
import { AiError, DEFAULT_MODELS, nvidiaConfig, type NvidiaConfig } from "@/lib/ai/nvidia";

const cfg: NvidiaConfig = { apiKey: "nvapi-test-key", baseUrl: "https://nim.test/v1", models: ["model-a", "model-b", "model-c"] };

const GOOD = {
  kind: "architecture",
  title: "Demo",
  nodes: [
    { id: "web", label: "Web", icon: "react" },
    { id: "api", label: "API", subtitle: "Node.js" },
    { id: "db", label: "PostgreSQL" },
  ],
  edges: [
    { from: "web", to: "api", label: "HTTPS" },
    { from: "api", to: "db", label: "SQL" },
  ],
};

function sse(content: string, opts: { reasoning?: string; finish?: string; split?: number } = {}): Response {
  const enc = new TextEncoder();
  const events: string[] = [];
  if (opts.reasoning) events.push(`data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: opts.reasoning } }] })}\n\n`);
  const size = opts.split ?? 40;
  for (let i = 0; i < content.length; i += size) events.push(`data: ${JSON.stringify({ choices: [{ delta: { content: content.slice(i, i + size) } }] })}\n\n`);
  events.push(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: opts.finish ?? "stop" }] })}\n\n`, "data: [DONE]\n\n");
  const stream = new ReadableStream({
    start(c) {
      // deliver in awkward chunk boundaries to exercise the line buffer
      const all = events.join("");
      for (let i = 0; i < all.length; i += 23) c.enqueue(enc.encode(all.slice(i, i + 23)));
      c.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

const input = { prompt: "Make me a diagram", kind: "auto" as const, complexity: "standard" as const };

describe("extractJson", () => {
  it("handles fences, prose, reasoning blocks and trailing commas", () => {
    const v = extractJson('<think>let me think { not json }</think>Sure!\n```json\n{"a": [1, 2,], "b": {"c": "d",},}\n```\nHope it helps').value;
    expect(v).toEqual({ a: [1, 2], b: { c: "d" } });
  });

  it("repairs a reply cut off mid-array", () => {
    const { value, repaired } = extractJson('{"nodes":[{"id":"a","label":"A"},{"id":"b","label":"B"},{"id":"c","lab');
    expect(repaired).toBe(true);
    expect((value as { nodes: unknown[] }).nodes.length).toBeGreaterThanOrEqual(2);
  });

  it("ignores braces inside strings", () => {
    expect(extractJson('{"label":"curly } brace { inside"}').value).toEqual({ label: "curly } brace { inside" });
  });

  it("throws when there is no object", () => {
    expect(() => extractJson("I cannot do that.")).toThrow();
  });
});

describe("nvidiaConfig", () => {
  it("uses sane defaults and treats placeholders as unset", () => {
    const c = nvidiaConfig({ NVIDIA_API_KEY: "your_nvidia_api_key_here" });
    expect(c.apiKey).toBeNull();
    expect(c.baseUrl).toBe("https://integrate.api.nvidia.com/v1");
    expect(c.models).toEqual(DEFAULT_MODELS);
  });

  it("honours overrides", () => {
    const c = nvidiaConfig({ NVIDIA_API_KEY: "nvapi-abc", NVIDIA_BASE_URL: "https://x.test/v1/", NVIDIA_MODELS: " m1 , m2 " });
    expect(c.apiKey).toBe("nvapi-abc");
    expect(c.baseUrl).toBe("https://x.test/v1");
    expect(c.models).toEqual(["m1", "m2"]);
  });
});

describe("generateGraph", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("streams a reply and returns a normalised graph plus DSL", async () => {
    fetchMock.mockResolvedValueOnce(sse("```json\n" + JSON.stringify(GOOD) + "\n```", { reasoning: "thinking..." }));
    const progress: number[] = [];
    const r = await generateGraph(input, cfg, { onProgress: (n) => progress.push(n) });
    expect(r.model).toBe("model-a");
    expect(r.graph.nodes.map((n) => n.id)).toEqual(["web", "api", "db"]);
    expect(r.graph.nodes[0].icon).toBe("brand:react");
    expect(r.dsl).toContain("Web > API: HTTPS");
    expect(progress.length).toBeGreaterThan(0);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://nim.test/v1/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer nvapi-test-key");
    const body = JSON.parse(init.body);
    expect(body.model).toBe("model-a");
    expect(body.stream).toBe(true);
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[0].content).toContain("ICON VOCABULARY");
  });

  it("feeds a failure back to the same model once", async () => {
    fetchMock.mockResolvedValueOnce(sse("Sorry, here you go: totally not json"));
    fetchMock.mockResolvedValueOnce(sse(JSON.stringify(GOOD)));
    const statuses: string[] = [];
    const r = await generateGraph(input, cfg, { onStatus: (s) => statuses.push(`${s.phase}:${s.model}`) });
    expect(r.attempts).toBe(2);
    expect(r.model).toBe("model-a");
    expect(statuses).toEqual(["thinking:model-a", "retry:model-a"]);
    const second = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(second.messages.at(-1).content).toContain("could not be used");
  });

  it("rejects a too-thin diagram and repairs it", async () => {
    fetchMock.mockResolvedValueOnce(sse(JSON.stringify({ nodes: [{ id: "a", label: "Only one" }], edges: [] })));
    fetchMock.mockResolvedValueOnce(sse(JSON.stringify(GOOD)));
    const r = await generateGraph(input, cfg);
    expect(r.graph.nodes).toHaveLength(3);
  });

  it("falls over to the next model on upstream errors", async () => {
    fetchMock.mockResolvedValueOnce(new Response("overloaded", { status: 503 }));
    fetchMock.mockResolvedValueOnce(sse(JSON.stringify(GOOD)));
    const r = await generateGraph(input, cfg);
    expect(r.model).toBe("model-b");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("falls over on rate limits too", async () => {
    fetchMock.mockResolvedValueOnce(new Response("slow down", { status: 429, headers: { "retry-after": "3" } }));
    fetchMock.mockResolvedValueOnce(sse(JSON.stringify(GOOD)));
    const r = await generateGraph(input, cfg);
    expect(r.model).toBe("model-b");
  });

  it("stops immediately on a rejected key", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 401 }));
    await expect(generateGraph(input, cfg)).rejects.toMatchObject({ code: "bad_key" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces the last error when every model fails", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response("boom", { status: 500 })));
    await expect(generateGraph(input, cfg)).rejects.toMatchObject({ code: "upstream" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("is a clear error when no key is configured", async () => {
    await expect(generateGraph(input, { ...cfg, apiKey: null })).rejects.toBeInstanceOf(AiError);
    await expect(generateGraph(input, { ...cfg, apiKey: null })).rejects.toMatchObject({ code: "not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("links orphan components instead of leaving islands", async () => {
    const withOrphan = { ...GOOD, nodes: [...GOOD.nodes, { id: "lonely", label: "Monitoring" }] };
    fetchMock.mockResolvedValueOnce(sse(JSON.stringify(withOrphan)));
    const r = await generateGraph(input, cfg);
    expect(r.graph.edges.some((e) => e.to === "lonely" || e.from === "lonely")).toBe(true);
    expect(r.warnings.some((w) => w.includes("Monitoring"))).toBe(true);
  });
});
