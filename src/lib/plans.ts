export type PlanId = 'free' | 'pro';

export interface Plan {
  id: PlanId;
  name: string;
  priceLabel: string;
  features: string[];
}

/**
 * Plan definitions. The Stripe price_id is read from env at call sites,
 * not stored here, so the template works before the user sets up Stripe.
 */
export const PLANS = {
  free: {
    id: 'free' as const,
    name: 'Free',
    priceLabel: '$0/mo',
    features: ['1 saved search', '20 scored leads / month', 'Daily digest email'],
  },
  pro: {
    id: 'pro' as const,
    name: 'Pro',
    priceLabel: '$19/mo',
    features: [
      'Unlimited saved searches',
      'Unlimited scored leads',
      'Real-time alerts',
      'Competitor radar',
    ],
  },
} satisfies Record<PlanId, Plan>;

export const PLAN_ORDER: PlanId[] = ['free', 'pro'];

export function isProPlan(plan: string | null | undefined): boolean {
  return plan === 'pro';
}
