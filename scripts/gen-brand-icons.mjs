// Generates lib/canvas/brand-icons.json (path data) and lib/canvas/brand-meta.json (labels + colours).
// Run with:  node scripts/gen-brand-icons.mjs
// Source: https://simpleicons.org (CC0). Only a curated subset relevant to system design is shipped.
import * as si from "simple-icons";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "lib", "canvas");

/** category -> slugs */
const CURATED = {
  Cloud: "googlecloud googlecloudstorage googlebigquery googlecloudspanner googlepubsub firebase cloudflare cloudflareworkers vercel netlify digitalocean railway render supabase planetscale neon convex",
  Auth: "clerk auth0 okta jsonwebtokens openid",
  Databases: "postgresql mysql mariadb mongodb redis sqlite elasticsearch opensearch clickhouse snowflake databricks neo4j influxdb couchbase cockroachlabs timescale prisma drizzle",
  Messaging: "apachekafka rabbitmq apachepulsar apacheflink apachespark apacheairflow apachehadoop celery socketdotio webrtc",
  "DevOps & Infra": "docker kubernetes helm terraform ansible pulumi nginx apache envoyproxy istio linkerd consul vault argo jenkins githubactions gitlab circleci github bitbucket git",
  Observability: "prometheus grafana datadog newrelic sentry opentelemetry jaeger elastic kibana logstash splunk pagerduty",
  Frontend: "react nextdotjs vuedotjs angular svelte astro remix gatsby vite webpack tailwindcss typescript javascript",
  Backend: "nodedotjs deno bun express nestjs fastify graphql apollographql trpc python django flask fastapi go rust spring springboot kotlin swift dotnet php laravel ruby rubyonrails elixir phoenixframework scala swagger postman",
  Mobile: "android ios apple flutter expo electron tauri",
  "AI & ML": "anthropic claude googlegemini huggingface pytorch tensorflow langchain ollama nvidia mistralai",
  "SaaS & APIs": "stripe paypal razorpay mailgun discord telegram whatsapp zoom notion linear jira confluence figma shopify wordpress strapi contentful sanity algolia meilisearch minio backblaze wasabi google meta",
  OS: "linux ubuntu debian redhat macos",
};

const bySlug = new Map();
for (const v of Object.values(si)) if (v && typeof v === "object" && v.slug) bySlug.set(v.slug, v);

const paths = {};
const meta = [];
for (const [category, list] of Object.entries(CURATED)) {
  for (const slug of list.split(/\s+/).filter(Boolean)) {
    const icon = bySlug.get(slug);
    if (!icon) {
      console.warn("missing brand icon:", slug);
      continue;
    }
    if (paths[slug]) continue;
    paths[slug] = icon.path;
    meta.push({ slug, title: icon.title, hex: "#" + icon.hex, category });
  }
}

writeFileSync(join(root, "brand-icons.json"), JSON.stringify(paths));
writeFileSync(join(root, "brand-meta.json"), JSON.stringify(meta));
console.log(`wrote ${meta.length} brand icons`);
