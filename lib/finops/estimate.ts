import { declaredCopies, nodeTextOf } from "../cloud/classify";
import type { El } from "../canvas/types";
import { formatUsd, ruleFor, type PriceRule, type Provider } from "./pricing-rules";

export interface CostItem {
  nodeId: string;
  label: string;
  rule: PriceRule;
  /** Copies the label promises ("x3", "3 replicas"); the monthly figure already includes them. */
  quantity: number;
  monthly: number;
}

export interface CostTip {
  id: string;
  message: string;
  /** Estimated saving in USD / month, when it can be computed. */
  savings?: number;
}

export interface CostEstimate {
  total: number;
  items: CostItem[];
  byProvider: Partial<Record<Provider, number>>;
  /** Components that look like infrastructure but have no price rule. */
  unpriced: number;
  tips: CostTip[];
}

const EMPTY: CostEstimate = { total: 0, items: [], byProvider: {}, unpriced: 0, tips: [] };

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Prices every recognised cloud component on the board and suggests savings. Only nodes that match a
 * rule are counted, so a whiteboard full of sticky notes estimates to $0 instead of a made-up number.
 */
export function estimateCost(els: Iterable<El>): CostEstimate {
  const items: CostItem[] = [];
  let unpriced = 0;
  for (const el of els) {
    const text = nodeTextOf(el);
    if (!text || (!text.label && !text.icon)) continue;
    const rule = ruleFor(text);
    if (!rule) {
      // A cloud-service icon we have no price for is worth flagging; plain boxes and logos are not.
      if (text.icon.startsWith("svc:")) unpriced++;
      continue;
    }
    const quantity = declaredCopies(text);
    items.push({ nodeId: el.id, label: text.label || rule.service, rule, quantity, monthly: round2(rule.monthly * quantity) });
  }
  if (items.length === 0) return { ...EMPTY, unpriced };

  const byProvider: CostEstimate["byProvider"] = {};
  let total = 0;
  for (const it of items) {
    total += it.monthly;
    byProvider[it.rule.provider] = round2((byProvider[it.rule.provider] ?? 0) + it.monthly);
  }
  return { total: round2(total), items, byProvider, unpriced, tips: costTips(items, total) };
}

function costTips(items: CostItem[], total: number): CostTip[] {
  const count = (id: string) => items.filter((i) => i.rule.id === id).reduce((n, i) => n + i.quantity, 0);
  const sum = (ids: string[]) => items.filter((i) => ids.includes(i.rule.id)).reduce((n, i) => n + i.monthly, 0);
  const tips: CostTip[] = [];

  const nat = count("aws-nat");
  if (nat > 0 && (count("aws-s3") > 0 || count("aws-dynamodb") > 0)) {
    const savings = Math.round(sum(["aws-nat"]) * 0.9);
    tips.push({ id: "nat-endpoint", message: `Replace NAT Gateway traffic to S3 / DynamoDB with free Gateway VPC Endpoints to save about $${savings}/mo.`, savings });
  }
  const albs = count("aws-elb");
  if (albs > 1) {
    const savings = Math.round((albs - 1) * 20);
    tips.push({ id: "consolidate-alb", message: `Consolidate ${albs} load balancers into one with host / path routing to save about $${savings}/mo.`, savings });
  }
  const clusters = count("aws-eks") + count("gcp-gke") + count("az-aks") + count("gen-k8s");
  if (clusters > 1) {
    const savings = Math.round((clusters - 1) * 73);
    tips.push({ id: "consolidate-clusters", message: `${clusters} Kubernetes control planes: separate namespaces on one cluster would save about $${savings}/mo.`, savings });
  }
  const vms = count("aws-ec2") + count("gcp-compute") + count("az-vm");
  if (vms >= 3) {
    const savings = Math.round(sum(["aws-ec2", "gcp-compute", "az-vm"]) * 0.3);
    tips.push({ id: "graviton-savings-plan", message: `${vms} always-on VMs: Graviton / Arm instances plus a 1-year Savings Plan typically cut compute by about 30% ($${savings}/mo here).`, savings });
  }
  if (count("aws-redshift") > 0) {
    tips.push({ id: "redshift-pause", message: "Redshift runs 24x7 in this estimate. Pause it outside working hours or move to Redshift Serverless for spiky workloads." });
  }
  if (count("aws-s3") + count("gcp-gcs") + count("az-blob") > 0) {
    tips.push({ id: "storage-lifecycle", message: "Add lifecycle rules (Intelligent-Tiering / Nearline) so cold objects stop costing hot-storage prices." });
  }
  if (total >= 500) {
    const savings = Math.round(total * 0.25);
    tips.push({ id: "commitments", message: `At this size, committed-use discounts on steady workloads can save roughly 25% (about $${savings}/mo).`, savings });
  }
  return tips.slice(0, 5);
}

/** RFC 4180 CSV of the itemised estimate, for finance / review. */
export function toCsv(estimate: CostEstimate): string {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows: (string | number)[][] = [["Component", "Provider", "Service", "Quantity", "Monthly USD", "Assumption"]];
  for (const it of [...estimate.items].sort((a, b) => b.monthly - a.monthly)) {
    rows.push([it.label, it.rule.provider, it.rule.service, it.quantity, it.monthly.toFixed(2), it.rule.assumption]);
  }
  rows.push(["Total", "", "", "", estimate.total.toFixed(2), "Estimate from public list prices; not a quote"]);
  return rows.map((r) => r.map(esc).join(",")).join("\r\n") + "\r\n";
}

export function describeTotal(estimate: CostEstimate): string {
  return estimate.items.length === 0 ? "No priced components" : `${formatUsd(estimate.total)} / mo`;
}
