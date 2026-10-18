/**
 * Smoke-tests your NVIDIA NIM setup:   npm run ai:check          (model availability + latency)
 *                                      npm run ai:check -- --full  (also runs a real diagram generation)
 * Reads NVIDIA_API_KEY / NVIDIA_MODELS from .env.local (via `tsx --env-file`).
 */
import { generateGraph } from "../lib/ai/generate";
import { extractJson } from "../lib/ai/json";
import { AiError, nvidiaConfig, streamChat } from "../lib/ai/nvidia";

const cfg = nvidiaConfig();
const full = process.argv.includes("--full");

const ok = (s: string) => `\x1b[32m${s}\x1b[0m`;
const bad = (s: string) => `\x1b[31m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

async function main() {
  console.log(`Endpoint: ${cfg.baseUrl}`);
  console.log(`Models to try (in order):\n${cfg.models.map((m) => `  - ${m}`).join("\n")}\n`);

  let catalog: string[] = [];
  try {
    const res = await fetch(`${cfg.baseUrl}/models`, { headers: cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {} });
    if (res.ok) catalog = ((await res.json()) as { data: { id: string }[] }).data.map((m) => m.id);
  } catch {
    /* offline */
  }
  if (catalog.length) {
    console.log(`Catalog reachable: ${catalog.length} models listed.`);
    for (const m of cfg.models) if (!catalog.includes(m)) console.log(bad(`  ✗ ${m} is not in the catalog (check the spelling, or pick another).`));
    console.log();
  } else console.log(dim("Could not read the model catalog (network?).\n"));

  if (!cfg.apiKey) {
    console.log(bad("NVIDIA_API_KEY is not set."));
    console.log("Create a free key at https://build.nvidia.com (profile → API Keys) and put it in .env.local:\n  NVIDIA_API_KEY=nvapi-...");
    process.exitCode = 1;
    return;
  }

  let working = 0;
  for (const model of cfg.models) {
    const t0 = Date.now();
    let firstByte = 0;
    try {
      const { text } = await streamChat({
        apiKey: cfg.apiKey,
        baseUrl: cfg.baseUrl,
        model,
        maxTokens: 120,
        temperature: 0,
        messages: [
          { role: "system", content: "Reply with ONE JSON object and nothing else." },
          { role: "user", content: 'Return {"ok": true, "numbers": [1, 2, 3]}' },
        ],
        onProgress: () => {
          if (!firstByte) firstByte = Date.now() - t0;
        },
        totalMs: 60_000,
      });
      let valid = false;
      try {
        valid = (extractJson(text).value as { ok?: boolean }).ok === true;
      } catch {
        valid = false;
      }
      working += valid ? 1 : 0;
      console.log(`${valid ? ok("✓") : bad("✗")} ${model}  ${dim(`${Date.now() - t0}ms total, first token ${firstByte || "?"}ms, ${valid ? "valid JSON" : "did not return valid JSON"}`)}`);
    } catch (e) {
      const err = e as AiError;
      console.log(`${bad("✗")} ${model}  ${dim(`${err.code ?? "error"}: ${err.message}`)}`);
      if (err.code === "bad_key") {
        console.log(bad("\nThe API key was rejected. Generate a new one at https://build.nvidia.com."));
        process.exitCode = 1;
        return;
      }
    }
  }
  console.log(`\n${working}/${cfg.models.length} models usable with your key.`);
  if (working === 0) process.exitCode = 1;

  if (full && working > 0) {
    console.log("\nRunning a full diagram generation…");
    const t0 = Date.now();
    const r = await generateGraph({ prompt: "URL shortener with API, Redis cache and PostgreSQL", kind: "auto", complexity: "simple" }, cfg, {
      onStatus: (s) => console.log(dim(`  ${s.phase} → ${s.model}`)),
    });
    console.log(ok(`✓ ${r.graph.kind} diagram: ${r.graph.nodes.length} components, ${r.graph.edges.length} connections via ${r.model} in ${Date.now() - t0}ms (${r.attempts} attempt${r.attempts > 1 ? "s" : ""})`));
    if (r.warnings.length) console.log(dim("  warnings: " + r.warnings.join(" | ")));
    console.log("\n" + r.dsl);
  }
}

void main();
