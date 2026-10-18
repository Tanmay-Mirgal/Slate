/**
 * Benchmark monthly prices (USD, 730 hours, public on-demand list prices for US regions) for the
 * building blocks that show up in architecture diagrams. They are deliberately round, documented
 * *assumptions*, not quotes: the point is to make the order of magnitude of a design visible while
 * it is being drawn, and to show which boxes drive the bill.
 */

export type Provider = "aws" | "gcp" | "azure" | "generic";

export interface PriceRule {
  id: string;
  provider: Provider;
  /** Name shown in the breakdown. */
  service: string;
  /** USD per month for one unit. */
  monthly: number;
  /** What one unit is, so the number can be challenged. */
  assumption: string;
  /** Icon keys that identify the service exactly. */
  icons: string[];
  /** Matches the node's text when it carries no (or a generic) icon. */
  keywords: RegExp;
}

export const PRICE_RULES: PriceRule[] = [
  /* ---------------------------------------------------------------- AWS */
  { id: "aws-ec2", provider: "aws", service: "EC2 (t4g.medium)", monthly: 24.53, assumption: "t4g.medium, 2 vCPU / 4 GiB, on-demand", icons: ["svc:aws-ec2"], keywords: /\bec2\b|t4g|t3\.|m5\.|c5\./ },
  { id: "aws-lambda", provider: "aws", service: "Lambda", monthly: 9, assumption: "5M invocations / month, 200 ms at 512 MB", icons: ["svc:aws-lambda"], keywords: /\blambda\b/ },
  { id: "aws-ecs", provider: "aws", service: "ECS Fargate task", monthly: 36.04, assumption: "1 vCPU / 2 GiB running 24x7", icons: ["svc:aws-ecs"], keywords: /\becs\b|fargate/ },
  { id: "aws-eks", provider: "aws", service: "EKS control plane", monthly: 73, assumption: "One cluster; worker nodes are priced as EC2", icons: ["svc:aws-eks"], keywords: /\beks\b/ },
  { id: "aws-rds", provider: "aws", service: "RDS / Aurora PostgreSQL", monthly: 65, assumption: "db.t4g.medium single-AZ + 100 GB gp3 (double for Multi-AZ)", icons: ["svc:aws-rds"], keywords: /\brds\b|aurora/ },
  { id: "aws-dynamodb", provider: "aws", service: "DynamoDB", monthly: 8, assumption: "On-demand: 10M reads, 2M writes, 10 GB", icons: ["svc:aws-dynamodb"], keywords: /dynamo/ },
  { id: "aws-elasticache", provider: "aws", service: "ElastiCache Redis", monthly: 23.36, assumption: "cache.t4g.small, single node", icons: ["svc:aws-elasticache"], keywords: /elasticache/ },
  { id: "aws-s3", provider: "aws", service: "S3", monthly: 3, assumption: "100 GB Standard + 1M requests", icons: ["svc:aws-s3"], keywords: /\bs3\b/ },
  { id: "aws-cloudfront", provider: "aws", service: "CloudFront", monthly: 9, assumption: "100 GB data transfer out + 10M requests", icons: ["svc:aws-cloudfront"], keywords: /cloudfront/ },
  { id: "aws-elb", provider: "aws", service: "Application Load Balancer", monthly: 22, assumption: "1 ALB, ~1 LCU average", icons: ["svc:aws-elb"], keywords: /\balb\b|\belb\b|\bnlb\b|application load balancer/ },
  { id: "aws-nat", provider: "aws", service: "NAT Gateway", monthly: 37, assumption: "One gateway + 100 GB processed", icons: [], keywords: /nat[- ]?gateway|\bnat gw\b/ },
  { id: "aws-apigw", provider: "aws", service: "API Gateway", monthly: 12, assumption: "REST API, 3M requests / month", icons: ["svc:aws-apigw"], keywords: /api[- ]?gateway/ },
  { id: "aws-sqs", provider: "aws", service: "SQS", monthly: 4, assumption: "10M requests / month", icons: ["svc:aws-sqs"], keywords: /\bsqs\b/ },
  { id: "aws-sns", provider: "aws", service: "SNS", monthly: 1, assumption: "1M publishes, mobile push excluded", icons: ["svc:aws-sns"], keywords: /\bsns\b/ },
  { id: "aws-route53", provider: "aws", service: "Route 53", monthly: 4.5, assumption: "1 hosted zone + 10M queries", icons: ["svc:aws-route53"], keywords: /route ?53/ },
  { id: "aws-cloudwatch", provider: "aws", service: "CloudWatch", monthly: 10, assumption: "10 GB logs + custom metrics + alarms", icons: ["svc:aws-cloudwatch"], keywords: /cloudwatch/ },
  { id: "aws-kinesis", provider: "aws", service: "Kinesis Data Streams", monthly: 12, assumption: "1 shard provisioned", icons: ["svc:aws-kinesis"], keywords: /kinesis/ },
  { id: "aws-redshift", provider: "aws", service: "Redshift", monthly: 182.5, assumption: "dc2.large, 1 node", icons: ["svc:aws-redshift"], keywords: /redshift/ },
  { id: "aws-stepfn", provider: "aws", service: "Step Functions", monthly: 12.5, assumption: "500k state transitions", icons: ["svc:aws-stepfn"], keywords: /step ?functions?/ },
  { id: "aws-eventbridge", provider: "aws", service: "EventBridge", monthly: 5, assumption: "5M custom events", icons: ["svc:aws-eventbridge"], keywords: /eventbridge/ },
  { id: "aws-waf", provider: "aws", service: "WAF", monthly: 16, assumption: "1 web ACL, 5 rules, 10M requests", icons: ["svc:aws-waf"], keywords: /\bwaf\b/ },
  { id: "aws-cognito", provider: "aws", service: "Cognito", monthly: 0, assumption: "First 50,000 monthly active users are free", icons: ["svc:aws-cognito"], keywords: /cognito/ },
  { id: "aws-vpc", provider: "aws", service: "VPC", monthly: 0, assumption: "No charge for the VPC itself", icons: ["svc:aws-vpc"], keywords: /^\s*vpc\s*$/ },
  { id: "aws-iam", provider: "aws", service: "IAM", monthly: 0, assumption: "No charge", icons: ["svc:aws-iam"], keywords: /^\s*iam\s*$/ },

  /* ---------------------------------------------------------------- GCP */
  { id: "gcp-compute", provider: "gcp", service: "Compute Engine (e2-medium)", monthly: 24.46, assumption: "e2-medium, 2 vCPU / 4 GiB, on-demand", icons: ["svc:gcp-compute"], keywords: /compute engine|\bgce\b|e2-medium/ },
  { id: "gcp-run", provider: "gcp", service: "Cloud Run", monthly: 17, assumption: "3M requests, 300 ms, 1 vCPU", icons: ["svc:gcp-run"], keywords: /cloud run/ },
  { id: "gcp-functions", provider: "gcp", service: "Cloud Functions", monthly: 6, assumption: "5M invocations / month", icons: ["svc:gcp-functions"], keywords: /cloud functions?/ },
  { id: "gcp-gke", provider: "gcp", service: "GKE cluster fee", monthly: 73, assumption: "One Standard cluster; nodes are priced as Compute Engine", icons: ["svc:gcp-gke"], keywords: /\bgke\b/ },
  { id: "gcp-gcs", provider: "gcp", service: "Cloud Storage", monthly: 2.5, assumption: "100 GB Standard + operations", icons: ["svc:gcp-gcs"], keywords: /cloud storage|\bgcs\b/ },
  { id: "gcp-lb", provider: "gcp", service: "Cloud Load Balancing", monthly: 19, assumption: "One forwarding rule + 100 GB processed", icons: ["svc:gcp-lb"], keywords: /cloud load balanc/ },
  { id: "gcp-sql", provider: "gcp", service: "Cloud SQL PostgreSQL", monthly: 100, assumption: "2 vCPU / 7.5 GiB, 100 GB SSD, single zone", icons: ["svc:gcp-sql"], keywords: /cloud sql/ },

  /* -------------------------------------------------------------- Azure */
  { id: "az-vm", provider: "azure", service: "Virtual Machine (B2s)", monthly: 30.4, assumption: "B2s, 2 vCPU / 4 GiB, pay-as-you-go", icons: ["svc:az-vm"], keywords: /azure vm|virtual machine/ },
  { id: "az-blob", provider: "azure", service: "Blob Storage", monthly: 3, assumption: "100 GB hot tier + operations", icons: ["svc:az-blob"], keywords: /blob storage/ },
  { id: "az-functions", provider: "azure", service: "Azure Functions", monthly: 5, assumption: "Consumption plan, 5M executions", icons: ["svc:az-functions"], keywords: /azure functions?/ },
  { id: "az-sql", provider: "azure", service: "Azure SQL Database", monthly: 75, assumption: "Standard S2 (50 DTU)", icons: ["svc:az-sql"], keywords: /azure sql/ },
  { id: "az-cosmos", provider: "azure", service: "Cosmos DB", monthly: 26, assumption: "400 RU/s provisioned + 10 GB", icons: ["svc:az-cosmos"], keywords: /cosmos/ },
  { id: "az-aks", provider: "azure", service: "AKS (standard tier)", monthly: 73, assumption: "Uptime-SLA control plane; nodes are priced as VMs", icons: ["svc:az-aks"], keywords: /\baks\b/ },
  { id: "az-servicebus", provider: "azure", service: "Service Bus", monthly: 10, assumption: "Standard tier, 10M operations", icons: ["svc:az-servicebus"], keywords: /service ?bus/ },
  { id: "az-apim", provider: "azure", service: "API Management", monthly: 11, assumption: "Consumption tier, 3M calls", icons: ["svc:az-apim"], keywords: /api management|\bapim\b/ },
  { id: "az-ad", provider: "azure", service: "Entra ID", monthly: 0, assumption: "Free tier", icons: ["svc:az-ad"], keywords: /entra|azure ad/ },

  /* ------------------------------------------------------------ Generic */
  // Products drawn by logo rather than by cloud service. Priced as the managed offering a team would likely buy.
  { id: "gen-postgres", provider: "generic", service: "Managed PostgreSQL", monthly: 65, assumption: "Managed, 2 vCPU / 4 GiB + 100 GB (RDS-class)", icons: ["brand:postgresql", "brand:mysql", "brand:mariadb"], keywords: /postgres|mysql|mariadb/ },
  { id: "gen-mongo", provider: "generic", service: "Managed MongoDB", monthly: 57, assumption: "Atlas M10-class cluster", icons: ["brand:mongodb"], keywords: /mongo/ },
  { id: "gen-redis", provider: "generic", service: "Managed Redis", monthly: 23.36, assumption: "1.5 GiB cache node", icons: ["brand:redis"], keywords: /\bredis\b/ },
  { id: "gen-kafka", provider: "generic", service: "Managed Kafka", monthly: 100, assumption: "3 small brokers (MSK-class)", icons: ["brand:apachekafka"], keywords: /kafka/ },
  { id: "gen-rabbit", provider: "generic", service: "Managed RabbitMQ", monthly: 25, assumption: "Single small broker", icons: ["brand:rabbitmq"], keywords: /rabbit/ },
  { id: "gen-search", provider: "generic", service: "Managed Elasticsearch", monthly: 52, assumption: "2 small data nodes", icons: ["brand:elasticsearch"], keywords: /elasticsearch|opensearch/ },
  { id: "gen-k8s", provider: "generic", service: "Managed Kubernetes control plane", monthly: 73, assumption: "One cluster; nodes are priced separately", icons: ["brand:kubernetes"], keywords: /kubernetes|\bk8s\b/ },
];

const BY_ICON = new Map<string, PriceRule>();
for (const rule of PRICE_RULES) for (const icon of rule.icons) BY_ICON.set(icon, rule);

/** The rule for a node: an exact icon match wins, then keywords against the label and subtitle. */
export function ruleFor(n: { label: string; subtitle: string; icon: string }): PriceRule | null {
  const byIcon = n.icon ? BY_ICON.get(n.icon) : undefined;
  if (byIcon) return byIcon;
  const text = `${n.label} ${n.subtitle}`.toLowerCase();
  if (!text.trim()) return null;
  // Prefer provider-specific rules over generic ones when both match.
  let generic: PriceRule | null = null;
  for (const rule of PRICE_RULES) {
    if (!rule.keywords.test(text)) continue;
    if (rule.provider !== "generic") return rule;
    generic ??= rule;
  }
  return generic;
}

export function formatUsd(n: number): string {
  const rounded = n >= 100 ? Math.round(n) : Math.round(n * 100) / 100;
  return `$${rounded.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}
