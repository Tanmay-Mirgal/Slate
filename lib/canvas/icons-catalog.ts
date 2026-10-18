import brandMeta from "./brand-meta.json";

/**
 * Lightweight icon metadata (no path data) shared by the client, the AI prompt
 * builder and the diagram layout engine. Path data lives in icons.ts.
 *
 * Keys:  lucide:<Name>   generic glyph from Lucide
 *        brand:<slug>    real product logo (Simple Icons, CC0)
 *        svc:<id>        cloud-provider service rendered as a tinted Lucide glyph
 */

export interface IconDef {
  key: string;
  label: string;
  category: string;
  keywords: string[];
  /** Broad search-only terms (never used for icon guessing). */
  tags?: string[];
  /** Default accent. */
  color?: string;
}

const split = (name: string) =>
  name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[\s_-]+/)
    .filter(Boolean);

/* ----------------------------------------------------------- Lucide (curated) */

export const LUCIDE_CURATED: Record<string, string[]> = {
  Compute: [
    "Server", "Cpu", "Container", "Boxes", "Box", "Layers", "Terminal", "Code", "Settings", "Workflow", "Bot",
    "Brain", "Rocket", "Zap", "Cloud", "CloudCog", "Microchip", "Component", "Puzzle", "Blocks", "Cog", "Gauge",
  ],
  Data: [
    "Database", "DatabaseZap", "HardDrive", "Archive", "FileText", "File", "Folder", "Table", "Warehouse",
    "MemoryStick", "Search", "ScanSearch", "Package", "FileJson", "FileCode", "Files", "Library", "Book", "Boxes",
  ],
  Network: [
    "Globe", "Network", "Router", "Wifi", "Waypoints", "Split", "Webhook", "Radio", "Cable", "Plug", "Share2",
    "ArrowLeftRight", "Link", "Antenna", "Satellite", "Cast", "Rss", "Signpost",
  ],
  Security: [
    "Shield", "ShieldCheck", "ShieldAlert", "Lock", "Unlock", "Key", "KeyRound", "Fingerprint", "UserCheck",
    "ScanFace", "Bug", "Eye", "EyeOff", "FileKey", "BadgeCheck", "Siren",
  ],
  Devices: [
    "Monitor", "Laptop", "Smartphone", "Tablet", "Watch", "Tv", "Gamepad2", "Headphones", "Camera", "Mic",
    "Printer", "Keyboard", "Mouse", "Speaker", "Router", "Usb", "Bluetooth", "Battery",
  ],
  People: [
    "User", "Users", "UserCog", "UserPlus", "Building2", "Briefcase", "Store", "GraduationCap", "Heart", "Smile",
    "Crown", "Handshake", "Contact", "CircleUser",
  ],
  Messaging: [
    "Mail", "MessageSquare", "MessagesSquare", "Bell", "Phone", "Video", "Send", "Inbox", "Megaphone",
    "AtSign", "MessageCircle", "Voicemail", "Calendar", "Newspaper",
  ],
  Business: [
    "ShoppingCart", "ShoppingBag", "CreditCard", "Wallet", "Receipt", "Banknote", "Landmark", "Truck", "Tag",
    "BarChart3", "TrendingUp", "PieChart", "Coins", "Gift", "Percent", "BadgeDollarSign", "Factory",
  ],
  Observability: [
    "Activity", "LineChart", "AlertTriangle", "AlertCircle", "FileSearch", "Timer", "Clock", "Hourglass",
    "ClipboardList", "ScrollText", "Stethoscope", "Radar", "Binary",
  ],
  Flow: [
    "Play", "Pause", "Square", "Circle", "Diamond", "Check", "X", "Flag", "Star", "Bookmark", "MapPin", "Home",
    "SlidersHorizontal", "Filter", "RefreshCw", "Download", "Upload", "Trash2", "Pencil", "Copy", "ArrowRight",
    "GitBranch", "GitMerge", "GitPullRequest", "Repeat", "Shuffle", "Lightbulb", "Target", "Compass", "Map",
  ],
};

/* --------------------------------------------------- cloud provider services */

interface SvcDef {
  id: string;
  label: string;
  lucide: string;
  color: string;
  /** Product-specific names used when guessing an icon from free text. */
  alias: string[];
  /** Broad terms that only help the icon picker's search. */
  tags: string[];
}

const AWS = "#FF9900";
const GCP = "#4285F4";
const AZ = "#0A84FF";

export const SERVICE_ICONS: SvcDef[] = [
  { id: "aws-ec2", label: "AWS EC2", lucide: "Server", color: AWS, alias: ["ec2"], tags: ["compute", "virtual machine", "vm"] },
  { id: "aws-lambda", label: "AWS Lambda", lucide: "Zap", color: AWS, alias: ["lambda"], tags: ["serverless", "function", "faas"] },
  { id: "aws-s3", label: "AWS S3", lucide: "Archive", color: AWS, alias: ["s3"], tags: ["object storage", "bucket", "storage"] },
  { id: "aws-rds", label: "AWS RDS", lucide: "Database", color: AWS, alias: ["rds", "aurora"], tags: ["database", "sql", "relational"] },
  { id: "aws-dynamodb", label: "AWS DynamoDB", lucide: "DatabaseZap", color: AWS, alias: ["dynamodb", "dynamo db"], tags: ["database", "nosql", "key value"] },
  { id: "aws-sqs", label: "AWS SQS", lucide: "Inbox", color: AWS, alias: ["sqs"], tags: ["queue", "message queue"] },
  { id: "aws-sns", label: "AWS SNS", lucide: "Bell", color: AWS, alias: ["sns"], tags: ["notification", "pubsub", "topic"] },
  { id: "aws-apigw", label: "AWS API Gateway", lucide: "Waypoints", color: AWS, alias: ["apigw"], tags: ["api gateway", "gateway", "api"] },
  { id: "aws-cloudfront", label: "AWS CloudFront", lucide: "Globe", color: AWS, alias: ["cloudfront"], tags: ["cdn", "edge"] },
  { id: "aws-route53", label: "AWS Route 53", lucide: "Signpost", color: AWS, alias: ["route53", "route 53"], tags: ["dns", "domain"] },
  { id: "aws-elb", label: "AWS ELB / ALB", lucide: "Split", color: AWS, alias: ["elb", "alb", "nlb"], tags: ["load balancer", "balancer"] },
  { id: "aws-ecs", label: "AWS ECS / Fargate", lucide: "Container", color: AWS, alias: ["ecs", "fargate"], tags: ["container", "docker"] },
  { id: "aws-eks", label: "AWS EKS", lucide: "Boxes", color: AWS, alias: ["eks"], tags: ["kubernetes", "k8s"] },
  { id: "aws-cognito", label: "AWS Cognito", lucide: "UserCheck", color: AWS, alias: ["cognito"], tags: ["auth", "identity", "users"] },
  { id: "aws-cloudwatch", label: "AWS CloudWatch", lucide: "Activity", color: AWS, alias: ["cloudwatch"], tags: ["monitoring", "metrics", "logs"] },
  { id: "aws-vpc", label: "AWS VPC", lucide: "Cloud", color: AWS, alias: ["vpc"], tags: ["network", "subnet"] },
  { id: "aws-iam", label: "AWS IAM", lucide: "KeyRound", color: AWS, alias: ["iam"], tags: ["permissions", "access", "security"] },
  { id: "aws-kinesis", label: "AWS Kinesis", lucide: "Waves", color: AWS, alias: ["kinesis", "firehose"], tags: ["stream", "streaming"] },
  { id: "aws-redshift", label: "AWS Redshift", lucide: "Warehouse", color: AWS, alias: ["redshift"], tags: ["data warehouse", "analytics"] },
  { id: "aws-elasticache", label: "AWS ElastiCache", lucide: "MemoryStick", color: AWS, alias: ["elasticache"], tags: ["cache", "memcached", "redis"] },
  { id: "aws-stepfn", label: "AWS Step Functions", lucide: "Workflow", color: AWS, alias: ["step functions"], tags: ["workflow", "state machine", "orchestration"] },
  { id: "aws-eventbridge", label: "AWS EventBridge", lucide: "Radio", color: AWS, alias: ["eventbridge"], tags: ["events", "event bus"] },
  { id: "aws-waf", label: "AWS WAF", lucide: "ShieldCheck", color: AWS, alias: ["waf"], tags: ["firewall", "security", "shield"] },
  { id: "gcp-compute", label: "GCP Compute Engine", lucide: "Server", color: GCP, alias: ["compute engine", "gce"], tags: ["compute", "vm"] },
  { id: "gcp-gcs", label: "GCP Cloud Storage", lucide: "Archive", color: GCP, alias: ["gcs"], tags: ["object storage", "bucket"] },
  { id: "gcp-run", label: "GCP Cloud Run", lucide: "Play", color: GCP, alias: ["cloud run"], tags: ["serverless", "container"] },
  { id: "gcp-functions", label: "GCP Cloud Functions", lucide: "Zap", color: GCP, alias: ["cloud functions"], tags: ["serverless", "function"] },
  { id: "gcp-gke", label: "GCP GKE", lucide: "Boxes", color: GCP, alias: ["gke"], tags: ["kubernetes", "k8s"] },
  { id: "gcp-lb", label: "GCP Load Balancer", lucide: "Split", color: GCP, alias: ["gcp load balancer"], tags: ["load balancer"] },
  { id: "gcp-sql", label: "GCP Cloud SQL", lucide: "Database", color: GCP, alias: ["cloud sql", "alloydb"], tags: ["database", "sql"] },
  { id: "az-vm", label: "Azure VM", lucide: "Server", color: AZ, alias: ["azure vm"], tags: ["compute", "virtual machine"] },
  { id: "az-blob", label: "Azure Blob Storage", lucide: "Archive", color: AZ, alias: ["azure blob", "blob storage"], tags: ["object storage", "storage"] },
  { id: "az-functions", label: "Azure Functions", lucide: "Zap", color: AZ, alias: ["azure functions"], tags: ["serverless", "function"] },
  { id: "az-sql", label: "Azure SQL", lucide: "Database", color: AZ, alias: ["azure sql"], tags: ["database", "sql"] },
  { id: "az-cosmos", label: "Azure Cosmos DB", lucide: "DatabaseZap", color: AZ, alias: ["cosmos db", "cosmosdb"], tags: ["database", "nosql"] },
  { id: "az-aks", label: "Azure AKS", lucide: "Boxes", color: AZ, alias: ["aks"], tags: ["kubernetes", "k8s"] },
  { id: "az-servicebus", label: "Azure Service Bus", lucide: "Inbox", color: AZ, alias: ["service bus"], tags: ["queue", "messaging"] },
  { id: "az-apim", label: "Azure API Management", lucide: "Waypoints", color: AZ, alias: ["apim"], tags: ["api gateway", "gateway"] },
  { id: "az-ad", label: "Azure AD / Entra", lucide: "UserCheck", color: AZ, alias: ["entra", "azure ad", "active directory"], tags: ["identity", "auth"] },
];


/* --------------------------------------------------------------- brand aliases */

const BRAND_ALIASES: Record<string, string[]> = {
  postgresql: ["postgres", "pg", "psql"],
  mongodb: ["mongo"],
  nextdotjs: ["next.js", "nextjs", "next"],
  nodedotjs: ["node", "node.js", "nodejs"],
  vuedotjs: ["vue", "vue.js"],
  kubernetes: ["k8s"],
  googlecloud: ["gcp", "google cloud"],
  apachekafka: ["kafka"],
  apacheflink: ["flink"],
  apachespark: ["spark"],
  apacheairflow: ["airflow"],
  apachehadoop: ["hadoop", "hdfs"],
  apachepulsar: ["pulsar"],
  elasticsearch: ["elastic search"],
  githubactions: ["github actions", "gha"],
  socketdotio: ["socket.io", "socketio", "websocket"],
  googlegemini: ["gemini"],
  express: ["express.js", "expressjs"],
  rubyonrails: ["rails"],
  dotnet: [".net", "asp.net"],
  springboot: ["spring boot"],
  googlebigquery: ["bigquery"],
  googlepubsub: ["pubsub", "pub/sub"],
  googlecloudstorage: ["gcs"],
  cloudflareworkers: ["workers"],
  jsonwebtokens: ["jwt"],
  envoyproxy: ["envoy"],
  opentelemetry: ["otel"],
  tailwindcss: ["tailwind"],
  huggingface: ["hugging face"],
  langchain: ["lang chain"],
  trpc: ["t rpc"],
  redhat: ["rhel", "red hat"],
  macos: ["mac os", "osx"],
  ios: ["iphone"],
};

const BRAND_LABEL_OVERRIDES: Record<string, string> = {
  nextdotjs: "Next.js",
  nodedotjs: "Node.js",
  vuedotjs: "Vue.js",
  socketdotio: "Socket.IO",
  dotnet: ".NET",
};

/* ------------------------------------------------------------------ the catalog */

function buildCatalog(): IconDef[] {
  const defs: IconDef[] = [];
  for (const [category, names] of Object.entries(LUCIDE_CURATED)) {
    for (const name of names) {
      const key = `lucide:${name}`;
      if (defs.some((d) => d.key === key)) continue;
      defs.push({ key, label: split(name).join(" ").replace(/\b\w/g, (c) => c.toUpperCase()), category, keywords: split(name) });
    }
  }
  for (const s of SERVICE_ICONS) {
    defs.push({
      key: `svc:${s.id}`,
      label: s.label,
      category: s.id.startsWith("aws") ? "AWS" : s.id.startsWith("gcp") ? "Google Cloud" : "Azure",
      keywords: [s.label.toLowerCase(), ...s.alias],
      tags: s.tags,
      color: s.color,
    });
  }
  for (const b of brandMeta as { slug: string; title: string; hex: string; category: string }[]) {
    const label = BRAND_LABEL_OVERRIDES[b.slug] || b.title;
    defs.push({
      key: `brand:${b.slug}`,
      label,
      category: b.category,
      keywords: [b.slug, label.toLowerCase(), ...(BRAND_ALIASES[b.slug] || [])],
      color: b.hex,
    });
  }
  return defs;
}

export const ICON_CATALOG: IconDef[] = buildCatalog();
const BY_KEY = new Map(ICON_CATALOG.map((d) => [d.key, d]));

export const ICON_CATEGORIES: string[] = Array.from(new Set(ICON_CATALOG.map((d) => d.category)));

export function findIconDef(key: string | undefined): IconDef | undefined {
  return key ? BY_KEY.get(key) : undefined;
}

export function serviceIcon(key: string): SvcDef | undefined {
  if (!key.startsWith("svc:")) return undefined;
  const id = key.slice(4);
  return SERVICE_ICONS.find((s) => s.id === id);
}

export function searchCatalog(query: string, limit = 120): IconDef[] {
  const q = query.trim().toLowerCase();
  if (!q) return ICON_CATALOG.slice(0, limit);
  const terms = q.split(/\s+/);
  const scored: [number, IconDef][] = [];
  for (const d of ICON_CATALOG) {
    const label = d.label.toLowerCase();
    let score = 0;
    for (const t of terms) {
      if (label === t) score += 10;
      else if (label.startsWith(t)) score += 6;
      else if (label.includes(t)) score += 4;
      else if (d.keywords.some((k) => k === t)) score += 5;
      else if (d.keywords.some((k) => k.startsWith(t) || k.includes(t))) score += 2;
      else if (d.tags?.some((k) => k === t || k.includes(t))) score += 1;
      else {
        score = 0;
        break;
      }
    }
    if (score > 0) scored.push([score, d]);
  }
  scored.sort((a, b) => b[0] - a[0] || a[1].label.localeCompare(b[1].label));
  return scored.slice(0, limit).map(([, d]) => d);
}

/* --------------------------------------------------------------- fuzzy guessing */

const KEYWORD_RULES: [RegExp, string][] = [
  [/\b(postgres|postgresql)\b/, "brand:postgresql"],
  [/\bmysql\b/, "brand:mysql"],
  [/\bmongo(db)?\b/, "brand:mongodb"],
  [/\bredis\b/, "brand:redis"],
  [/\bkafka\b/, "brand:apachekafka"],
  [/\brabbit ?mq\b/, "brand:rabbitmq"],
  [/\belastic ?search\b/, "brand:elasticsearch"],
  [/\bdocker\b/, "brand:docker"],
  [/\b(kubernetes|k8s)\b/, "brand:kubernetes"],
  [/\bnginx\b/, "brand:nginx"],
  [/\bgraphql\b/, "brand:graphql"],
  [/\bstripe\b/, "brand:stripe"],
  [/\bprometheus\b/, "brand:prometheus"],
  [/\bgrafana\b/, "brand:grafana"],
  [/\bsentry\b/, "brand:sentry"],
  [/\bterraform\b/, "brand:terraform"],
  [/\bcloudflare\b/, "brand:cloudflare"],
  [/\bvercel\b/, "brand:vercel"],
  [/\bsupabase\b/, "brand:supabase"],
  [/\bfirebase\b/, "brand:firebase"],
  [/\bclerk\b/, "brand:clerk"],
  [/\bauth0\b/, "brand:auth0"],
  [/\bnext\.?js\b/, "brand:nextdotjs"],
  [/\breact\b/, "brand:react"],
  [/\bvue\b/, "brand:vuedotjs"],
  [/\bangular\b/, "brand:angular"],
  [/\bnode(\.?js)?\b/, "brand:nodedotjs"],
  [/\bpython\b/, "brand:python"],
  [/\bdjango\b/, "brand:django"],
  [/\bfastapi\b/, "brand:fastapi"],
  [/\bgithub\b/, "brand:github"],
  [/\bgitlab\b/, "brand:gitlab"],
  [/\bjenkins\b/, "brand:jenkins"],
  [/\bopenai\b|\bgpt\b/, "lucide:Brain"],
  [/\bclaude\b|\banthropic\b/, "brand:anthropic"],
  [/\bs3\b/, "svc:aws-s3"],
  [/\blambda\b/, "svc:aws-lambda"],
  [/\bec2\b/, "svc:aws-ec2"],
  [/\bdynamo ?db\b/, "svc:aws-dynamodb"],
  [/\b(sqs)\b/, "svc:aws-sqs"],
  [/\bcloudfront\b/, "svc:aws-cloudfront"],
  [/\bcognito\b/, "svc:aws-cognito"],
  [/\b(cdn|edge)\b/, "lucide:Globe"],
  [/\b(load ?balancer|alb|elb|nlb|ingress)\b/, "lucide:Split"],
  [/\b(api ?gateway|gateway|reverse proxy|proxy)\b/, "lucide:Waypoints"],
  [/\b(cache|caching|memcached)\b/, "lucide:MemoryStick"],
  [/\b(queue|message broker|broker|event bus|pub ?sub|stream)\b/, "lucide:Inbox"],
  [/\b(worker|job|cron|scheduler|background)\b/, "lucide:Cog"],
  [/\b(database|db|sql|datastore|data store|repository|table)\b/, "lucide:Database"],
  [/\b(object storage|blob|bucket|file storage|storage)\b/, "lucide:Archive"],
  [/\b(search|index)\b/, "lucide:ScanSearch"],
  [/\b(auth|authentication|authorization|oauth|sso|login|jwt|identity|rbac|session)\b/, "lucide:ShieldCheck"],
  [/\b(secret|vault|key|kms|encryption)\b/, "lucide:KeyRound"],
  [/\b(monitor|metrics|observability|logging|logs|tracing|telemetry)\b/, "lucide:Activity"],
  [/\b(alert|pager|incident)\b/, "lucide:Siren"],
  [/\b(email|mail|smtp)\b/, "lucide:Mail"],
  [/\b(notification|push|sms|webhook)\b/, "lucide:Bell"],
  [/\b(payment|billing|checkout|invoice)\b/, "lucide:CreditCard"],
  [/\b(cart|order|e-?commerce|shop)\b/, "lucide:ShoppingCart"],
  [/\b(inventory|warehouse|shipping|delivery)\b/, "lucide:Package"],
  [/\b(user|customer|client user|person|actor)\b/, "lucide:User"],
  [/\b(admin|operator|team)\b/, "lucide:UserCog"],
  [/\b(mobile|ios|android|app)\b/, "lucide:Smartphone"],
  [/\b(browser|web client|web app|frontend|front-end|spa|ui)\b/, "lucide:Monitor"],
  [/\b(ml|machine learning|model|inference|llm|ai|rag|embedding|vector)\b/, "lucide:Brain"],
  [/\b(analytics|bi|dashboard|report|warehouse)\b/, "lucide:BarChart3"],
  [/\b(video|stream|media|transcod)/, "lucide:Video"],
  [/\b(chat|message|messaging|websocket|realtime|real-time)\b/, "lucide:MessageSquare"],
  [/\b(ci|cd|pipeline|build|deploy)\b/, "lucide:Workflow"],
  [/\b(service|microservice|backend|server|api|controller|handler|engine|processor)\b/, "lucide:Server"],
];

interface GuessEntry {
  key: string;
  kw: string;
  re: RegExp;
}
let guessIndex: GuessEntry[] | null = null;

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function getGuessIndex(): GuessEntry[] {
  if (guessIndex) return guessIndex;
  const index: GuessEntry[] = [];
  for (const d of ICON_CATALOG) {
    if (!d.key.startsWith("brand:") && !d.key.startsWith("svc:")) continue;
    for (const kw of new Set(d.keywords)) {
      if (kw.length < 3) continue;
      const re = new RegExp(`(^|[^a-z0-9])${escapeRegExp(kw)}($|[^a-z0-9])`);
      index.push({ key: d.key, kw, re });
    }
  }
  guessIndex = index;
  return index;
}

export function guessIcon(...parts: (string | undefined)[]): string | undefined {
  const text = parts.filter(Boolean).join(" ").toLowerCase();
  if (!text.trim()) return undefined;
  // The most specific (longest) product keyword wins: "google cloud storage" beats "google cloud".
  let best: GuessEntry | undefined;
  for (const entry of getGuessIndex()) {
    if (entry.re.test(text) && (!best || entry.kw.length > best.kw.length)) best = entry;
  }
  if (best) return best.key;
  for (const [re, key] of KEYWORD_RULES) if (re.test(text)) return key;
  return undefined;
}

export function isValidIconKey(key: string | undefined | null): boolean {
  if (!key) return false;
  if (BY_KEY.has(key)) return true;
  // Any Lucide glyph is acceptable even if not curated (validated at render time).
  return /^lucide:[A-Za-z0-9]+$/.test(key);
}

/** A compact list of icon keys for LLM prompts. */
export function iconKeysForPrompt(): string {
  const groups = new Map<string, string[]>();
  for (const d of ICON_CATALOG) {
    const arr = groups.get(d.category) || [];
    arr.push(d.key);
    groups.set(d.category, arr);
  }
  return Array.from(groups.entries())
    .map(([cat, keys]) => `${cat}: ${keys.join(", ")}`)
    .join("\n");
}

/** Very compact icon vocabulary for LLM prompts: logo slugs, cloud-service ids and a few generic glyphs. */
export function iconHintsForPrompt(): string {
  const brands = ICON_CATALOG.filter((d) => d.key.startsWith("brand:")).map((d) => d.key.slice(6));
  const services = ICON_CATALOG.filter((d) => d.key.startsWith("svc:")).map((d) => d.key.slice(4));
  const generic = [
    "User", "Users", "Smartphone", "Monitor", "Globe", "Server", "Database", "MemoryStick", "Inbox", "Cog", "Zap",
    "Waypoints", "Split", "ShieldCheck", "KeyRound", "Lock", "Mail", "Bell", "CreditCard", "ShoppingCart", "Package",
    "BarChart3", "Activity", "Brain", "Bot", "Cloud", "Archive", "HardDrive", "ScanSearch", "MessageSquare", "Video",
    "Truck", "Workflow", "Container", "Boxes", "Network", "Router", "Radio", "FileText", "Folder", "Calendar", "Clock",
    "Search", "Settings", "Code", "Terminal", "Cpu", "Webhook", "GitBranch", "Rocket", "Siren", "Building2", "Store",
  ];
  return `Product logos: ${brands.join(", ")}
Cloud services: ${services.join(", ")}
Generic glyphs (Lucide): ${generic.join(", ")}`;
}
