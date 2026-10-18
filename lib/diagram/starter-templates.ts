import { TEMPLATES } from "./templates";

/**
 * One-click starters for the dashboard. Each is a Slate diagram-as-code document (the same DSL the
 * AI emits), so it goes through the normal layout engine when the board opens. The interview starter
 * has no diagram: it opens an empty board with interview mode switched on.
 */

export type StarterId = "aws-microservices" | "database-erd" | "nextjs-stack" | "auth-flow" | "system-design-interview";

export interface StarterTemplate {
  id: StarterId;
  title: string;
  /** Board title used when the template is cloned. */
  boardTitle: string;
  description: string;
  /** Short chips shown on the card. */
  tags: string[];
  /** Accent used for the card glow. */
  accent: string;
  /** Diagram-as-code source; null for the interview board. */
  dsl: string | null;
  /** Open the new board with the interview timer and rubric running. */
  interview?: boolean;
  /** Which of the five hand-drawn dashboard illustrations to use as the board thumbnail. */
  thumbnailIcon: "1" | "2" | "3" | "4" | "5";
}

const AWS_MICROSERVICES = `title AWS microservices architecture
type architecture
direction right

Users [icon: lucide:Users]
CloudFront [icon: aws-cloudfront, subtitle: "CDN · TLS"]
S3 assets [icon: aws-s3, subtitle: "Static assets"]
API Gateway [icon: aws-apigw, subtitle: "REST · throttling · auth"]
Application load balancer [icon: aws-elb, subtitle: "Layer 7"]

VPC [color: orange] {
  ECS cluster [color: purple] {
    Orders service [icon: aws-ecs, subtitle: "ECS Fargate"]
    Catalog service [icon: aws-ecs, subtitle: "ECS Fargate"]
    Payments service [icon: aws-ecs, subtitle: "ECS Fargate"]
  }
  Data tier [color: green] {
    Aurora PostgreSQL [icon: aws-rds, subtitle: "Aurora · Multi-AZ"]
    ElastiCache [icon: aws-elasticache, subtitle: "Redis"]
  }
}
SQS [icon: aws-sqs, subtitle: "Order events"]
CloudWatch [icon: aws-cloudwatch, subtitle: "Logs · metrics · alarms"]

Users > CloudFront: HTTPS
CloudFront > S3 assets: static
CloudFront > API Gateway: /api
API Gateway > Application load balancer
Application load balancer > Orders service
Application load balancer > Catalog service
Application load balancer > Payments service
Orders service > Aurora PostgreSQL: SQL
Catalog service > ElastiCache: cache
Catalog service > Aurora PostgreSQL: SQL
Payments service > Aurora PostgreSQL: SQL
Orders service --> SQS: OrderPlaced
SQS --> Payments service: charge
Orders service --> CloudWatch
`;

const NEXTJS_STACK = `title Next.js fullstack stack
type architecture
direction right

Browser [icon: lucide:Monitor, subtitle: "React 19 · Tailwind"]

Vercel [color: gray] {
  Next.js [icon: nextdotjs, subtitle: "App Router · RSC"]
  Route handlers [icon: lucide:Webhook, subtitle: "/api/*"]
}
Clerk [icon: clerk, subtitle: "Auth · sessions"]
Convex [color: orange] {
  Convex functions [icon: convex, subtitle: "Queries · mutations"]
  Convex database [icon: lucide:Database, subtitle: "Realtime documents"]
}
Stripe [icon: stripe, subtitle: "Billing"]
LLM provider [icon: lucide:Brain, subtitle: "AI generation"]

Browser > Next.js: HTTPS
Browser > Clerk: sign in
Browser <> Convex functions: WebSocket (live queries)
Next.js > Route handlers
Route handlers > Clerk: verify session
Route handlers > Convex functions: server calls
Route handlers > Stripe: checkout
Route handlers > LLM provider: prompts
Stripe --> Route handlers: webhooks
Convex functions > Convex database
`;

const DATABASE_ERD = `title SaaS billing schema (PostgreSQL)
type erd

users {
  id uuid pk
  email text unique
  name text
  created_at timestamptz
}
workspaces {
  id uuid pk
  owner_id uuid fk
  name text
  created_at timestamptz
}
workspace_members {
  workspace_id uuid fk
  user_id uuid fk
  role text
}
subscriptions {
  id uuid pk
  workspace_id uuid fk
  plan text
  status text
  current_period_end timestamptz
}
invoices {
  id uuid pk
  subscription_id uuid fk
  amount_paise bigint
  currency text
  paid_at timestamptz
}

users > workspaces: 1 : N
users > workspace_members: 1 : N
workspaces > workspace_members: 1 : N
workspaces > subscriptions: 1 : N
subscriptions > invoices: 1 : N
`;

const AUTH_FLOW = TEMPLATES.find((t) => t.id === "oauth-sequence")?.dsl ?? "";

export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    id: "aws-microservices",
    title: "AWS Microservices",
    boardTitle: "AWS microservices architecture",
    description: "API Gateway, ECS Fargate, Aurora RDS, S3 and CloudFront",
    tags: ["AWS", "Backend"],
    accent: "#f59e0b",
    dsl: AWS_MICROSERVICES,
    thumbnailIcon: "1",
  },
  {
    id: "database-erd",
    title: "Database ERD",
    boardTitle: "Database schema",
    description: "Users, workspaces, subscriptions and invoices in PostgreSQL",
    tags: ["PostgreSQL", "Data"],
    accent: "#38bdf8",
    dsl: DATABASE_ERD,
    thumbnailIcon: "2",
  },
  {
    id: "nextjs-stack",
    title: "Next.js Stack",
    boardTitle: "Next.js fullstack stack",
    description: "App Router, Convex backend, Clerk auth and Tailwind",
    tags: ["Next.js", "Frontend"],
    accent: "#a78bfa",
    dsl: NEXTJS_STACK,
    thumbnailIcon: "3",
  },
  {
    id: "auth-flow",
    title: "Auth Flow",
    boardTitle: "OAuth 2.0 and JWT flow",
    description: "Sequence diagram of client, auth provider and resource server",
    tags: ["OAuth 2.0", "API design"],
    accent: "#34d399",
    dsl: AUTH_FLOW,
    thumbnailIcon: "4",
  },
  {
    id: "system-design-interview",
    title: "System Design Interview",
    boardTitle: "System design interview",
    description: "Empty canvas with a 45-minute timer and requirement rubric",
    tags: ["Interview", "45 min"],
    accent: "#fb7185",
    dsl: null,
    interview: true,
    thumbnailIcon: "5",
  },
];

export function starterById(id: string | null | undefined): StarterTemplate | null {
  return STARTER_TEMPLATES.find((t) => t.id === id) ?? null;
}
