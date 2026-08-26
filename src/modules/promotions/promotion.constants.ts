export const DiscountType = {
  PERCENT: 'PERCENT',
  FIXED_AMOUNT: 'FIXED_AMOUNT',
} as const;

export type DiscountType = (typeof DiscountType)[keyof typeof DiscountType];

export const DISCOUNT_TYPES: readonly string[] = Object.values(DiscountType);

/**
 * What a promotion applies to. Lowercase because these are the exact strings the frontend
 * sends and iKiotMS-BE stored — see the same reasoning in `location-type.ts`.
 */
export const ApplicableRuleType = {
  ALL: 'all',
  CATEGORY: 'category',
  PRODUCT: 'product',
} as const;

export type ApplicableRuleType =
  (typeof ApplicableRuleType)[keyof typeof ApplicableRuleType];

export const APPLICABLE_RULE_TYPES: readonly string[] =
  Object.values(ApplicableRuleType);

export const PromotionStatus = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
} as const;

export type PromotionStatus =
  (typeof PromotionStatus)[keyof typeof PromotionStatus];

export const PROMOTION_STATUSES: readonly string[] =
  Object.values(PromotionStatus);

/**
 * How many promotions may be combined on one order.
 *
 * Two, and only when every one of them is marked `stackable`. Ported from the hardcoded
 * limit in iKiotMS-BE's PricingEngine — the cap exists because the per-item clamp that
 * stops a stacked discount exceeding an item's price gets progressively harder to reason
 * about (and to explain to a cashier) the more promotions pile onto the same line.
 */
export const MAX_STACKED_PROMOTIONS = 2;
