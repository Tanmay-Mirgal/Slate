import type { DiagramKind } from "./graph";

export interface Template {
  id: string;
  title: string;
  description: string;
  kind: DiagramKind;
  /** Space-separated words used to match a prompt when AI isn't available. */
  keywords: string;
  dsl: string;
}

export const TEMPLATES: Template[] = [
  {
    id: "microservices-ecommerce",
    title: "Microservices e-commerce",
    description: "Gateway, domain services, event bus and polyglot storage",
    kind: "architecture",
    keywords: "ecommerce e-commerce shop store microservices checkout orders payments inventory marketplace",
    dsl: `title E-commerce platform
type architecture
direction right

Clients {
  Web app [icon: nextdotjs, subtitle: "Storefront"]
  Mobile app [icon: lucide:Smartphone, subtitle: "iOS · Android"]
}
Edge [color: blue] {
  CDN [icon: cloudflare]
  API gateway [subtitle: "Authn · rate limits"]
}
Services [color: purple] {
  Auth service [icon: lucide:ShieldCheck, subtitle: "JWT · OAuth"]
  Catalog service [icon: nodedotjs]
  Order service [icon: nodedotjs]
  Payment service [icon: stripe, subtitle: "Stripe"]
}
Data [color: green] {
  PostgreSQL [subtitle: "Orders & users"]
  Redis [subtitle: "Sessions · cache"]
  Elasticsearch [subtitle: "Product search"]
  Kafka [subtitle: "Order events"]
}
Web app > CDN: HTTPS
Mobile app > API gateway: HTTPS
CDN > API gateway
API gateway > Auth service: verify token
API gateway > Catalog service
API gateway > Order service
Order service > Payment service: charge
Order service > PostgreSQL: SQL
Auth service > Redis
Catalog service > Elasticsearch
Order service --> Kafka: OrderPlaced
Kafka --> Fulfilment worker [icon: lucide:Cog]
Fulfilment worker > Email provider [icon: lucide:Mail, subtitle: "SendGrid"]
`,
  },
  {
    id: "aws-three-tier",
    title: "AWS three-tier web app",
    description: "ALB, auto-scaled compute, RDS and S3 inside a VPC",
    kind: "architecture",
    keywords: "aws amazon cloud vpc ec2 rds s3 alb three tier web hosting",
    dsl: `title AWS three-tier application
type architecture
direction down

Users [icon: lucide:Users]
Route 53 [icon: aws-route53]
CloudFront [icon: aws-cloudfront, subtitle: "CDN"]

VPC [color: orange] {
  Public subnets [color: blue] {
    Application load balancer [icon: aws-elb]
  }
  Private subnets [color: purple] {
    Web servers [icon: aws-ec2, subtitle: "Auto Scaling group"]
    API servers [icon: aws-ec2, subtitle: "Auto Scaling group"]
  }
  Data subnets [color: green] {
    Aurora [icon: aws-rds, subtitle: "Multi-AZ"]
    ElastiCache [icon: aws-elasticache, subtitle: "Redis"]
  }
}
Static assets [icon: aws-s3]
CloudWatch [icon: aws-cloudwatch]

Users > Route 53: DNS
Route 53 > CloudFront
CloudFront > Application load balancer: HTTPS
CloudFront > Static assets
Application load balancer > Web servers
Web servers > API servers
API servers > Aurora: SQL
API servers > ElastiCache
API servers --> CloudWatch: metrics
`,
  },
  {
    id: "cicd-pipeline",
    title: "CI/CD pipeline",
    description: "Commit to production with tests, image build and Kubernetes rollout",
    kind: "architecture",
    keywords: "ci cd cicd pipeline deploy deployment devops github actions docker kubernetes release build",
    dsl: `title CI/CD pipeline
type architecture
direction right

Developer [icon: lucide:User]
GitHub [icon: github, subtitle: "Pull request"]
Pipeline [color: blue] {
  Lint & unit tests [icon: githubactions]
  Build image [icon: docker]
  Security scan [icon: lucide:ShieldCheck]
}
Registry [icon: lucide:Archive, subtitle: "Container registry"]
Production [color: green] {
  Kubernetes [icon: kubernetes, subtitle: "Rolling update"]
  Prometheus [icon: prometheus]
  Grafana [icon: grafana]
}
Developer > GitHub: git push
GitHub > Lint & unit tests: webhook
Lint & unit tests > Build image
Build image > Security scan
Security scan > Registry: push
Registry > Kubernetes: pull
Kubernetes > Prometheus: metrics
Prometheus > Grafana
Grafana --> Developer: alerts
`,
  },
  {
    id: "oauth-sequence",
    title: "OAuth 2.0 + JWT login",
    description: "Authorization-code flow between browser, app, identity provider and API",
    kind: "sequence",
    keywords: "oauth auth authentication login jwt sso openid sequence token authorization code flow",
    dsl: `title OAuth 2.0 authorization code flow
type sequence

User [icon: lucide:User]
Browser [icon: lucide:Monitor]
Web app [icon: nextdotjs]
Identity provider [icon: auth0]
API [icon: lucide:Server]

User > Browser: Click "Sign in"
Browser > Web app: GET /login
Web app > Identity provider: Redirect with client_id + PKCE
Identity provider > User: Show consent screen
User > Identity provider: Approve
Identity provider > Web app: Redirect with code
Web app > Identity provider: Exchange code for tokens
Identity provider --> Web app: access_token + id_token
Web app > API: Request with Bearer token
API > API: Verify JWT signature
API --> Web app: 200 OK
Web app --> Browser: Set session cookie
`,
  },
  {
    id: "event-driven",
    title: "Event-driven order system",
    description: "Producers, a Kafka backbone, consumers and a dead-letter queue",
    kind: "architecture",
    keywords: "event driven events kafka message queue pub sub streaming consumers producers saga cqrs",
    dsl: `title Event-driven order processing
type architecture
direction right

Order API [icon: nodedotjs, subtitle: "Produces events"]
Kafka [icon: apachekafka, subtitle: "orders topic"]
Consumers [color: purple] {
  Payment processor [icon: stripe]
  Inventory service [icon: lucide:Package]
  Notification service [icon: lucide:Bell]
  Analytics pipeline [icon: apacheflink]
}
Dead-letter queue [icon: lucide:Inbox, subtitle: "Failed events"]
PostgreSQL [subtitle: "Order state"]
Data warehouse [icon: snowflake]

Order API > PostgreSQL: SQL
Order API --> Kafka: OrderPlaced
Kafka --> Payment processor
Kafka --> Inventory service
Kafka --> Notification service
Kafka --> Analytics pipeline
Payment processor --> Dead-letter queue: retries exhausted
Analytics pipeline > Data warehouse
`,
  },
  {
    id: "blog-erd",
    title: "Blog database schema",
    description: "Users, posts, comments and tags with keys and relationships",
    kind: "erd",
    keywords: "database schema erd entity relationship tables sql blog users posts comments tags model data model",
    dsl: `title Blog schema
type erd

users {
  id uuid pk
  email text unique
  name text
  created_at timestamp
}
posts {
  id uuid pk
  author_id uuid fk
  title text
  body text
  published_at timestamp
}
comments {
  id uuid pk
  post_id uuid fk
  author_id uuid fk
  body text
}
tags {
  id uuid pk
  name text unique
}
post_tags {
  post_id uuid fk
  tag_id uuid fk
}

users > posts: 1 : N
posts > comments: 1 : N
users > comments: 1 : N
posts > post_tags: 1 : N
tags > post_tags: 1 : N
`,
  },
  {
    id: "login-flowchart",
    title: "Login flowchart",
    description: "Credentials, MFA, lockout and session creation",
    kind: "flowchart",
    keywords: "flowchart flow login sign in authentication process decision algorithm mfa password",
    dsl: `title Login flow
type flowchart
direction down

Start [shape: terminator]
User enters email and password
Credentials valid? [shape: decision]
MFA enabled? [shape: decision]
Verify one-time code
Code correct? [shape: decision]
Create session [shape: process]
Show error and count attempt
Too many attempts? [shape: decision]
Lock account for 15 minutes
Dashboard [shape: terminator]

Start > User enters email and password
User enters email and password > Credentials valid?
Credentials valid? > MFA enabled?: Yes
Credentials valid? > Show error and count attempt: No
MFA enabled? > Create session: No
MFA enabled? > Verify one-time code: Yes
Verify one-time code > Code correct?
Code correct? > Create session: Yes
Code correct? > Show error and count attempt: No
Show error and count attempt > Too many attempts?
Too many attempts? > Lock account for 15 minutes: Yes
Too many attempts? > User enters email and password: No
Create session > Dashboard
`,
  },
  {
    id: "rag-assistant",
    title: "RAG AI assistant",
    description: "Ingestion, vector search and an LLM gateway with streaming",
    kind: "architecture",
    keywords: "ai rag llm assistant chatbot embeddings vector search retrieval openai claude machine learning genai",
    dsl: `title RAG assistant
type architecture
direction right

Chat UI [icon: react, subtitle: "Streaming responses"]
API server [icon: fastapi]
Retrieval [color: purple] {
  Query rewriter [icon: lucide:Brain]
  Vector search [icon: lucide:ScanSearch, subtitle: "Top-k"]
  Reranker [icon: lucide:BarChart3]
}
LLM gateway [icon: lucide:Waypoints, subtitle: "Routing · retries"]
LLM provider [icon: nvidia, subtitle: "Hosted model"]
Ingestion [color: green] {
  Document store [icon: lucide:Archive, subtitle: "PDFs · wiki"]
  Chunker & embedder [icon: lucide:Cog]
  Vector DB [icon: lucide:Database]
}
Chat UI > API server: SSE
API server > Query rewriter
Query rewriter > Vector search
Vector search > Reranker
Vector search > Vector DB: ANN query
Reranker > LLM gateway: context
API server > LLM gateway: prompt
LLM gateway > LLM provider
Document store > Chunker & embedder
Chunker & embedder > Vector DB: upsert
`,
  },
  {
    id: "realtime-chat",
    title: "Real-time chat",
    description: "WebSocket gateways, presence, pub/sub fan-out and message storage",
    kind: "architecture",
    keywords: "chat realtime real-time messaging websocket presence slack whatsapp pubsub notifications",
    dsl: `title Real-time chat
type architecture
direction right

Client apps [icon: lucide:Smartphone, subtitle: "Web · iOS · Android"]
Load balancer [icon: lucide:Split]
WebSocket gateways [color: blue] {
  Gateway 1 [icon: socketdotio]
  Gateway 2 [icon: socketdotio]
}
Redis pub/sub [icon: redis, subtitle: "Fan-out"]
Chat service [icon: nodedotjs]
Presence service [icon: lucide:Radio, subtitle: "Online status"]
Cassandra [icon: lucide:Database, subtitle: "Message history"]
Push notifications [icon: lucide:Bell, subtitle: "APNs · FCM"]

Client apps > Load balancer: WSS
Load balancer > Gateway 1
Load balancer > Gateway 2
Gateway 1 > Redis pub/sub
Gateway 2 > Redis pub/sub
Redis pub/sub > Chat service
Chat service > Cassandra: persist
Chat service > Presence service
Chat service --> Push notifications: offline users
`,
  },
  {
    id: "launch-mindmap",
    title: "Product launch mind map",
    description: "Branches for marketing, product, engineering and support",
    kind: "mindmap",
    keywords: "mind map mindmap brainstorm launch plan product marketing roadmap ideas planning",
    dsl: `title Product launch
type mindmap

Product launch
Marketing
Product
Engineering
Support
Landing page
Launch email
Social campaign
Press kit
Final QA
Pricing
Docs
Onboarding flow
Load testing
Feature flags
Rollback plan
Help center
Support runbook
On-call rota

Product launch > Marketing
Product launch > Product
Product launch > Engineering
Product launch > Support
Marketing > Landing page
Marketing > Launch email
Marketing > Social campaign
Marketing > Press kit
Product > Final QA
Product > Pricing
Product > Docs
Product > Onboarding flow
Engineering > Load testing
Engineering > Feature flags
Engineering > Rollback plan
Support > Help center
Support > Support runbook
Support > On-call rota
`,
  },
];

/** Closest template to a free-text prompt (word overlap), or null if nothing is related. */
export function matchTemplate(prompt: string): Template | null {
  const words = new Set(prompt.toLowerCase().split(/[^a-z0-9+#.]+/).filter((w) => w.length > 2));
  let best: Template | null = null;
  let bestScore = 0;
  for (const t of TEMPLATES) {
    const hay = new Set(`${t.title} ${t.description} ${t.keywords}`.toLowerCase().split(/[^a-z0-9+#.]+/));
    let score = 0;
    for (const w of words) if (hay.has(w)) score += 2;
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return bestScore >= 2 ? best : null;
}
