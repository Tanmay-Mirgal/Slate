import type { El } from "../canvas/types";

/**
 * Reads what a canvas node *is* from its icon and text, so cost estimation, single-point-of-failure
 * detection and the interview review can all reason about the same architecture without each
 * re-implementing keyword matching.
 */

export type NodeKind = "client" | "edge" | "gateway" | "loadbalancer" | "auth" | "compute" | "database" | "cache" | "queue" | "storage" | "monitoring" | "other";

export interface NodeText {
  id: string;
  /** Primary text: card title, icon label, shape text. */
  label: string;
  subtitle: string;
  /** Icon key, e.g. "svc:aws-ec2" or "brand:postgresql". */
  icon: string;
}

/** Elements that represent a component of the system. Text boxes, notes, frames and scribbles do not. */
export function nodeTextOf(el: El): NodeText | null {
  switch (el.type) {
    case "card":
      return { id: el.id, label: el.title, subtitle: el.subtitle ?? "", icon: el.icon ?? "" };
    case "icon":
      return { id: el.id, label: el.label ?? "", subtitle: "", icon: el.icon };
    case "shape":
      return el.text || el.icon ? { id: el.id, label: el.text ?? "", subtitle: "", icon: el.icon ?? "" } : null;
    case "table":
      return { id: el.id, label: el.title, subtitle: "", icon: "lucide:Table" };
    default:
      return null;
  }
}

const haystack = (n: NodeText) => `${n.label} ${n.subtitle} ${n.icon}`.toLowerCase();

const KIND_RULES: [NodeKind, RegExp][] = [
  ["client", /\b(users?|clients?|browser|mobile|web ?app|frontend|front-end|customers?|end[- ]?users?|devices?|ios|android|spa)\b|lucide:(users?|smartphone|monitor|laptop)\b/],
  ["edge", /cloudfront|cloudflare|\bcdn\b|route ?53|\bdns\b|\bwaf\b|edge|fastly|akamai|front ?door/],
  ["gateway", /api[- ]?gateway|aws-apigw|az-apim|\bapim\b|\bkong\b|gateway|traefik|envoy|ingress/],
  ["loadbalancer", /load[- ]?balanc|aws-elb|gcp-lb|\balb\b|\bnlb\b|\belb\b|haproxy|nginx|reverse proxy/],
  ["auth", /\bauth\b|cognito|clerk|auth0|keycloak|identity|\biam\b|\bsso\b|oauth|login|az-ad|okta/],
  ["cache", /redis|memcache|elasticache|\bcache\b|varnish|hazelcast/],
  ["queue", /kafka|\bsqs\b|\bsns\b|rabbit|pub\/?sub|servicebus|service bus|kinesis|eventbridge|event ?bus|\bqueue\b|\btopic\b|nats|activemq|\bmq\b|sidekiq|celery/],
  ["database", /postgres|mysql|mariadb|mongo|dynamo|cosmos|aurora|aws-rds|gcp-sql|az-sql|cassandra|\brds\b|\bsql\b|database|\bdb\b|redshift|bigquery|snowflake|clickhouse|elasticsearch|opensearch|neo4j|cockroach|supabase|prisma|convex database/],
  ["storage", /\bs3\b|aws-s3|gcs|az-blob|blob|object storage|\bstorage\b|minio|bucket|\befs\b|\bebs\b|file store/],
  ["monitoring", /cloudwatch|grafana|prometheus|datadog|new ?relic|sentry|logging|\blogs?\b|observability|monitoring|metrics|splunk|kibana|jaeger|tracing/],
  ["compute", /\bec2\b|aws-ec2|lambda|\becs\b|\beks\b|fargate|gke|gcp-compute|gcp-run|functions?\b|az-vm|az-aks|kubernetes|k8s|docker|container|service|server|worker|\bapi\b|backend|app\b|vm\b|node(js)?|next(js)?|django|flask|spring|express|fastapi|rails|laravel|go\b|rust|cron|job/],
];

export function kindOf(n: NodeText): NodeKind {
  const text = haystack(n);
  for (const [kind, re] of KIND_RULES) if (re.test(text)) return kind;
  return "other";
}

/** Managed services that are replicated across zones by the provider; drawing one box for them is not a single point of failure. */
const INHERENTLY_REDUNDANT =
  /aws-s3|aws-cloudfront|aws-route53|aws-dynamodb|aws-sqs|aws-sns|aws-lambda|aws-apigw|aws-cognito|aws-eventbridge|aws-kinesis|aws-stepfn|aws-waf|aws-iam|aws-vpc|aws-cloudwatch|gcp-gcs|gcp-run|gcp-functions|az-blob|az-functions|az-cosmos|az-servicebus|az-apim|az-ad|\bs3\b|cloudfront|cloudflare|route ?53|dynamodb|\bsqs\b|\bsns\b|lambda|cognito|eventbridge|kinesis|bigquery|firestore|pub\/?sub|cosmos|clerk|auth0|stripe|razorpay|vercel|convex|supabase|github|\bcdn\b|\bdns\b|serverless|managed|third[- ]?party/;

export function isInherentlyRedundant(n: NodeText): boolean {
  return INHERENTLY_REDUNDANT.test(haystack(n));
}

/**
 * How many copies of this component the label promises: "x3", "3 replicas", "Multi-AZ", "Auto Scaling
 * group", "cluster". 1 means a single instance.
 */
export function declaredCopies(n: NodeText): number {
  const text = `${n.label} ${n.subtitle}`.toLowerCase();
  const times = text.match(/(?:\bx|×)\s*(\d{1,3})\b|\b(\d{1,3})\s*(?:x\b|×|replicas?|instances?|nodes?|pods?|brokers?|shards?|copies|workers?|tasks?)/);
  if (times) {
    const count = Number(times[1] ?? times[2]);
    if (count >= 1) return Math.min(count, 100);
  }
  if (/multi[- ]?az|cross[- ]?az|active[- ]?active|active[- ]?passive|primary\s*(?:\/|and|&|\+)\s*(?:standby|replica|secondary)|read replica|failover|standby|high[- ]?availability|\bha\b|replicated/.test(text)) return 2;
  if (/auto[- ]?scal|\basg\b|\bhpa\b|scale[- ]?out|horizontally scaled|fleet|autoscal/.test(text)) return 2;
  if (/\bcluster\b|\bsharded\b|\bquorum\b|\bring\b/.test(text)) return 3;
  return 1;
}

/** "API 1", "API-2", "api_b" -> "api": used to spot siblings drawn as separate boxes. */
export function familyKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/[\s_-]*(?:#?\d+|[a-d]|primary|secondary|replica|standby|backup)$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}
