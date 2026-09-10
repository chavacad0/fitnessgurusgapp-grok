/**
 * SESSION_PLANS — Fixed plan catalogue for FitnessGuruSG.
 *
 * These are the three purchasable coaching packages.
 * Prices are in SGD. Coaches collect payment externally (cash, PayNow, bank transfer).
 * When Stripe is added, each plan will map 1:1 to a Stripe Price ID.
 *
 * DO NOT store these in MongoDB — they are product constants, not coach-configurable data.
 *
 * Official pricing (updated 2026-05):
 *   Starter Pack      — 10 sessions — SGD 1,900 — 1.5 months / 45 days
 *   Performance Pack  — 20 sessions — SGD 3,500 — 3 months   / 90 days
 *   Elite Pack        — 30 sessions — SGD 4,800 — 6 months   / 180 days
 */

export const SESSION_PLANS = [
    {
        id:           'starter',
        name:         'Starter Pack',
        sessions:     10,
        price_sgd:    1900,
        expiry_days:  45,   // 1.5 months
        description:  '10 sessions · 1.5 months validity',
        badge_color:  '#3B82F6',   // blue
        // stripe_price_id: 'price_xxx',  // ← reserved for Phase 10
    },
    {
        id:           'performance',
        name:         'Performance Pack',
        sessions:     20,
        price_sgd:    3500,
        expiry_days:  90,   // 3 months
        description:  '20 sessions · 3 months validity',
        badge_color:  '#8B5CF6',   // purple
    },
    {
        id:           'elite',
        name:         'Elite Pack',
        sessions:     30,
        price_sgd:    4800,
        expiry_days:  180,  // 6 months
        description:  '30 sessions · 6 months validity',
        badge_color:  '#F59E0B',   // amber
    },
] as const;

export type PlanId = typeof SESSION_PLANS[number]['id'];

export type SessionPlanDefinition = typeof SESSION_PLANS[number];

/**
 * Look up a plan by its id. Returns undefined for unknown ids.
 */
export function getPlanById(id: string): SessionPlanDefinition | undefined {
    return SESSION_PLANS.find(p => p.id === id) as SessionPlanDefinition | undefined;
}

/**
 * Compute the ISO expiry date from today + plan's expiry_days.
 * Returns YYYY-MM-DD in Asia/Singapore timezone.
 */
export function computeExpiryDate(expiry_days: number): string {
    const todaySGT = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
    const expiry   = new Date(`${todaySGT}T00:00:00+08:00`);
    expiry.setDate(expiry.getDate() + expiry_days);
    return expiry.toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
}
