// Ported from iKiotMS-BE's src/constants/subscription.js.
export const GRACE_PERIOD_DAYS = 3;
export const REMINDER_DAYS = [7, 3, 1];
export const BILLING_DAYS: Record<string, number> = {
  MONTHLY: 30,
  YEARLY: 365,
};
export const QR_EXPIRY_MS = 15 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

export function getBillingDays(
  billingCycle: string | null | undefined,
): number {
  return (
    (billingCycle ? BILLING_DAYS[billingCycle] : undefined) ??
    BILLING_DAYS.MONTHLY
  );
}

// Ported from iKiotMS-BE's src/constants/planFeatures.js — the fixed set of feature
// flags a Plan.features[] entry may contain (validated by UpdatePlanDto).
export const PLAN_FEATURES = {
  STOCK_MOVEMENT: 'stock_movement',
  SALES: 'sales',
  REPORTS: 'reports',
  HR_MANAGEMENT: 'hr_management',
  PAYROLL: 'payroll',
} as const;

export const VALID_PLAN_FEATURES: string[] = Object.values(PLAN_FEATURES);
