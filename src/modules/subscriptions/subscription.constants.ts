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

/** Midnight UTC of the day `date` falls on. */
export function startOfDayUTC(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

/**
 * Whole days from one date to another, counted between midnights so the answer never
 * depends on what time of day the request happened to arrive. (Dividing the raw
 * millisecond gap and rounding up — the previous approach — reported "10 days left" or
 * "11 days left" for the same subscription depending on the hour, which made both the UI
 * and any test of it unstable.) Negative when `later` is before `earlier`.
 */
export function wholeDaysBetween(earlier: Date, later: Date): number {
  return Math.round(
    (startOfDayUTC(later).getTime() - startOfDayUTC(earlier).getTime()) /
      DAY_MS,
  );
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
