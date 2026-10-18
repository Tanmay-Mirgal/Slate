/**
 * Plan catalogue. Prices are in paise (INR) because Razorpay amounts are integers in the smallest
 * currency unit. Pure data: shared by the pricing modal, the API routes and the Convex backend.
 */

export type Tier = "free" | "pro" | "team";
export type Interval = "monthly" | "annual";
export type PaidTier = Exclude<Tier, "free">;

export const TIERS: Tier[] = ["free", "pro", "team"];

export type Feature = "finopsItemization" | "finopsCsv" | "hdExport" | "trafficSimulator" | "unlimitedBoards" | "teamCollaboration";

export interface PlanLimits {
  /** `null` means unlimited. */
  maxBoards: number | null;
  aiCreditsMonthly: number;
}

export interface PlanDef {
  id: Tier;
  name: string;
  tagline: string;
  /** Paise per month; for per-seat plans this is per seat. */
  monthly: number;
  /** Paise per year (per seat for per-seat plans). Equals 0 for the free plan. */
  annual: number;
  perSeat: boolean;
  limits: PlanLimits;
  features: string[];
  /** Highlighted card in the pricing modal. */
  popular?: boolean;
}

export const PLANS: Record<Tier, PlanDef> = {
  free: {
    id: "free",
    name: "Free",
    tagline: "For trying Slate on a side project",
    monthly: 0,
    annual: 0,
    perSeat: false,
    limits: { maxBoards: 3, aiCreditsMonthly: 15 },
    features: ["3 boards", "15 AI diagram credits / month", "Personal workspace", "Standard PNG / SVG export", "Cloud cost estimate (total)"],
  },
  pro: {
    id: "pro",
    name: "Pro",
    tagline: "For engineers who design systems every week",
    monthly: 99_900,
    annual: 899_900,
    perSeat: false,
    limits: { maxBoards: null, aiCreditsMonthly: 300 },
    features: ["Unlimited boards", "300 AI diagram credits / month", "4K HD export", "FinOps itemization + CSV export", "Priority AI models"],
    popular: true,
  },
  team: {
    id: "team",
    name: "Team",
    tagline: "For teams that review architecture together",
    monthly: 199_900,
    annual: 1_799_900,
    perSeat: true,
    limits: { maxBoards: null, aiCreditsMonthly: 1000 },
    features: ["Everything in Pro", "1,000 AI diagram credits / month", "Unlimited workspaces", "Team collaboration & roles", "Traffic flow simulator"],
  },
};

/** Lowest tier that includes each feature. The simulator ships open to everyone until the product team decides to gate it. */
export const FEATURE_MIN_TIER: Record<Feature, Tier> = {
  finopsItemization: "pro",
  finopsCsv: "pro",
  hdExport: "pro",
  unlimitedBoards: "pro",
  teamCollaboration: "team",
  trafficSimulator: "free",
};

const RANK: Record<Tier, number> = { free: 0, pro: 1, team: 2 };

export function tierAtLeast(tier: Tier, min: Tier): boolean {
  return RANK[tier] >= RANK[min];
}

export function hasFeature(tier: Tier, feature: Feature): boolean {
  return tierAtLeast(tier, FEATURE_MIN_TIER[feature]);
}

export function isPaidTier(value: unknown): value is PaidTier {
  return value === "pro" || value === "team";
}

export function isInterval(value: unknown): value is Interval {
  return value === "monthly" || value === "annual";
}

/** Total in paise for one checkout. Seats only apply to per-seat plans. */
export function priceFor(tier: PaidTier, interval: Interval, seats = 1): number {
  const plan = PLANS[tier];
  const unit = interval === "annual" ? plan.annual : plan.monthly;
  return unit * (plan.perSeat ? Math.max(1, Math.floor(seats)) : 1);
}

/** "₹999", "₹8,999", "₹0". Whole rupees only: no plan has paise. */
export function formatInr(paise: number): string {
  const rupees = Math.round(paise / 100);
  return `₹${rupees.toLocaleString("en-IN")}`;
}

/** What a yearly plan saves compared with twelve monthly payments, as a whole percentage. */
export function annualSavingsPct(tier: PaidTier): number {
  const plan = PLANS[tier];
  const yearly = plan.monthly * 12;
  return yearly === 0 ? 0 : Math.round(((yearly - plan.annual) / yearly) * 100);
}
