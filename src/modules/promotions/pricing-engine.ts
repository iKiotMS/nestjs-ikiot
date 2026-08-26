import { BadRequestException } from '@nestjs/common';
import {
  ApplicableRuleType,
  DiscountType,
  MAX_STACKED_PROMOTIONS,
  PromotionStatus,
} from './promotion.constants';

/**
 * The discount calculator. **No database access, by design** — the caller fetches the
 * candidate promotions, resolves each cart line's category, and pre-loads how many times
 * this customer has already used each promotion, then hands all of it in.
 *
 * That separation is the whole reason this is testable: every rule below is a decision
 * about money that a cashier will have to defend to a customer, and none of them needs a
 * connection to check.
 *
 * Ported from iKiotMS-BE's `src/modules/promotion/service/PricingEngine.js`, which was
 * already structured this way. One behavioural change: it threw bare `Error`s, which the
 * old controller turned into 400s by hand; here they are `BadRequestException` so the
 * global filter does it.
 *
 * **Applying a promotion is always explicit.** The caller passes the exact ids the user
 * picked. This module never guesses a "best" combination — a till that silently chooses
 * a different discount than the one the cashier tapped is a support call.
 */

/** A promotion, in the shape this module needs. The service maps Prisma rows into it. */
export interface PricingPromotion {
  id: string;
  promoName: string;
  /** Carried for the picker's benefit only — no rule below reads it. */
  description: string | null;
  status: string;
  startDate: Date;
  endDate: Date;
  discountType: string;
  discountValue: number;
  maxDiscountAmount: number | null;
  minOrderValue: number;
  stackable: boolean;
  usageLimit: number | null;
  usageLimitPerCustomer: number | null;
  usedCount: number;
  /** Empty = applies tenant-wide. Non-empty = only at these branches. */
  branchIds: string[];
  applicableRuleType: string;
  ruleCategoryIds: string[];
  ruleProductItemIds: string[];
}

export interface CartItem {
  productItemId: string;
  categoryId: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface CartContext {
  branchId: string | null;
  customerId: string | null;
  subtotal: number;
  items: CartItem[];
}

export interface EligibilityVerdict {
  eligible: boolean;
  reason: string | null;
}

export interface CandidateEntry {
  promotion: PricingPromotion;
  eligible: boolean;
  reason: string | null;
  matchedItems: CartItem[];
  previewDiscount: number;
}

export interface PricingResult {
  appliedPromotions: {
    promotionId: string;
    promoName: string;
    discountAmount: number;
  }[];
  totalDiscount: number;
  itemBreakdown: { productItemId: string; discountAmount: number }[];
  grandTotal: number;
}

/** Money is stored to 2dp but discounts are whole đồng — round once, at the edges. */
const round = (amount: number): number => Math.round(amount);

const vnd = (amount: number) => amount.toLocaleString('vi-VN');

export function ruleMatchesItem(
  promotion: PricingPromotion,
  item: CartItem,
): boolean {
  switch (promotion.applicableRuleType) {
    case ApplicableRuleType.ALL:
      return true;
    case ApplicableRuleType.CATEGORY:
      return (
        item.categoryId !== null &&
        promotion.ruleCategoryIds.includes(item.categoryId)
      );
    case ApplicableRuleType.PRODUCT:
      return promotion.ruleProductItemIds.includes(item.productItemId);
    default:
      return false;
  }
}

export function getMatchedItems(
  promotion: PricingPromotion,
  items: CartItem[],
): CartItem[] {
  return items.filter((item) => ruleMatchesItem(promotion, item));
}

export function isWithinDateRange(
  promotion: PricingPromotion,
  now: Date,
): boolean {
  return now >= promotion.startDate && now <= promotion.endDate;
}

export function matchedSubtotal(matchedItems: CartItem[]): number {
  return matchedItems.reduce((sum, item) => sum + item.lineTotal, 0);
}

/**
 * What one promotion is worth on its own, before any stacking clamp.
 *
 * A FIXED_AMOUNT discount never exceeds what the matched items are actually worth —
 * otherwise a 100k voucher on a 40k item would start paying the customer.
 */
export function rawDiscount(
  promotion: PricingPromotion,
  matchedItems: CartItem[],
): number {
  const subtotal = matchedSubtotal(matchedItems);

  if (promotion.discountType === DiscountType.PERCENT) {
    const amount = (subtotal * promotion.discountValue) / 100;
    return round(
      promotion.maxDiscountAmount !== null
        ? Math.min(amount, promotion.maxDiscountAmount)
        : amount,
    );
  }

  return round(Math.min(promotion.discountValue, subtotal));
}

/**
 * Can this promotion be used on this cart, and if not, why not?
 *
 * The reason string is shown to the cashier, so every branch returns one.
 *
 * `customerUsageCounts` maps promotion id → how many times this cart's customer has
 * already used it. Only promotions that actually cap per customer need an entry.
 */
export function evaluateEligibility(
  promotion: PricingPromotion,
  cart: CartContext,
  now: Date = new Date(),
  customerUsageCounts: Record<string, number> = {},
): EligibilityVerdict {
  if (promotion.status !== PromotionStatus.ACTIVE) {
    return { eligible: false, reason: 'Khuyến mãi không hoạt động' };
  }
  if (!isWithinDateRange(promotion, now)) {
    return {
      eligible: false,
      reason: 'Khuyến mãi chưa bắt đầu hoặc đã kết thúc',
    };
  }
  if (
    promotion.branchIds.length > 0 &&
    (cart.branchId === null || !promotion.branchIds.includes(cart.branchId))
  ) {
    return { eligible: false, reason: 'Không áp dụng cho chi nhánh này' };
  }
  if (cart.subtotal < promotion.minOrderValue) {
    return {
      eligible: false,
      reason: `Đơn hàng chưa đạt giá trị tối thiểu ${vnd(promotion.minOrderValue)}đ`,
    };
  }
  if (
    promotion.usageLimit !== null &&
    promotion.usedCount >= promotion.usageLimit
  ) {
    return { eligible: false, reason: 'Khuyến mãi đã hết lượt sử dụng' };
  }
  if (promotion.usageLimitPerCustomer !== null) {
    // A per-customer cap means nothing without knowing who the customer is. Excluded
    // rather than waved through — silently skipping the check would let a walk-in cart
    // use a once-per-customer promotion every time.
    if (!cart.customerId) {
      return {
        eligible: false,
        reason: 'Cần chọn khách hàng để áp dụng khuyến mãi này',
      };
    }
    const used = customerUsageCounts[promotion.id] ?? 0;
    if (used >= promotion.usageLimitPerCustomer) {
      return {
        eligible: false,
        reason: 'Khách hàng đã hết lượt sử dụng khuyến mãi này',
      };
    }
  }
  if (getMatchedItems(promotion, cart.items).length === 0) {
    return {
      eligible: false,
      reason: 'Không áp dụng cho sản phẩm trong giỏ hàng',
    };
  }
  return { eligible: true, reason: null };
}

/**
 * Every candidate promotion, annotated with eligibility and a standalone preview of what
 * it would take off. Powers the "pick a discount" list, which shows ineligible ones too —
 * with the reason — because "why can't I use this voucher" is the question being asked.
 */
export function buildCandidateList(
  promotions: PricingPromotion[],
  cart: CartContext,
  now: Date = new Date(),
  customerUsageCounts: Record<string, number> = {},
): CandidateEntry[] {
  return promotions.map((promotion) => {
    const { eligible, reason } = evaluateEligibility(
      promotion,
      cart,
      now,
      customerUsageCounts,
    );
    const matchedItems = getMatchedItems(promotion, cart.items);
    return {
      promotion,
      eligible,
      reason,
      matchedItems,
      previewDiscount: eligible ? rawDiscount(promotion, matchedItems) : 0,
    };
  });
}

/**
 * Spreads each promotion's discount across the lines it matched, in proportion to what
 * each line contributes, then clamps each line's **accumulated** discount to its own
 * total.
 *
 * The clamp is the point: two stackable promotions that both match the same SKU would
 * otherwise discount it past its own price, and the order would end up owing the customer
 * money.
 */
export function allocatePerItemDiscount(
  applied: { matchedItems: CartItem[]; discount: number }[],
): Map<string, number> {
  const perItem = new Map<string, number>();

  for (const { matchedItems, discount } of applied) {
    const subtotal = matchedSubtotal(matchedItems);
    if (subtotal <= 0 || discount <= 0) continue;
    for (const item of matchedItems) {
      const share = round((item.lineTotal / subtotal) * discount);
      perItem.set(
        item.productItemId,
        (perItem.get(item.productItemId) ?? 0) + share,
      );
    }
  }

  for (const item of applied.flatMap((entry) => entry.matchedItems)) {
    const current = perItem.get(item.productItemId) ?? 0;
    if (current > item.lineTotal) {
      perItem.set(item.productItemId, item.lineTotal);
    }
  }

  return perItem;
}

function emptyResult(cart: CartContext): PricingResult {
  return {
    appliedPromotions: [],
    totalDiscount: 0,
    itemBreakdown: cart.items.map((item) => ({
      productItemId: item.productItemId,
      discountAmount: 0,
    })),
    grandTotal: round(cart.subtotal),
  };
}

/**
 * Resolves the exact set of promotions the user chose against the cart.
 *
 * Throws — as a 400 — when a chosen promotion is unknown, no longer eligible, or the
 * combination breaks the stacking rules. Failing loudly is deliberate: quietly dropping
 * one of two selected promotions would charge the customer more than the screen said.
 */
export function resolveSelectedPromotions(
  promotions: PricingPromotion[],
  selectedIds: string[],
  cart: CartContext,
  now: Date = new Date(),
  customerUsageCounts: Record<string, number> = {},
): PricingResult {
  const uniqueIds = [...new Set(selectedIds)];
  if (uniqueIds.length === 0) return emptyResult(cart);

  if (uniqueIds.length > MAX_STACKED_PROMOTIONS) {
    throw new BadRequestException(
      `Chỉ được chọn tối đa ${MAX_STACKED_PROMOTIONS} khuyến mãi cộng dồn`,
    );
  }

  const byId = new Map(
    promotions.map((promotion) => [promotion.id, promotion]),
  );
  const resolved = uniqueIds.map((id) => {
    const promotion = byId.get(id);
    if (!promotion) {
      throw new BadRequestException(
        'Một khuyến mãi đã chọn không còn tồn tại hoặc không áp dụng cho đơn này',
      );
    }
    const { eligible, reason } = evaluateEligibility(
      promotion,
      cart,
      now,
      customerUsageCounts,
    );
    if (!eligible) {
      throw new BadRequestException(
        `Khuyến mãi "${promotion.promoName}" không đủ điều kiện: ${reason}`,
      );
    }
    return promotion;
  });

  if (resolved.length > 1 && !resolved.every((p) => p.stackable)) {
    throw new BadRequestException(
      'Chỉ có thể chọn thêm khuyến mãi được phép cộng dồn (stackable)',
    );
  }

  const computed = resolved.map((promotion) => {
    const matchedItems = getMatchedItems(promotion, cart.items);
    return {
      promotion,
      matchedItems,
      discount: rawDiscount(promotion, matchedItems),
    };
  });

  const perItem = allocatePerItemDiscount(computed);
  const itemBreakdown = cart.items.map((item) => ({
    productItemId: item.productItemId,
    discountAmount: perItem.get(item.productItemId) ?? 0,
  }));

  const totalDiscount = Math.min(
    itemBreakdown.reduce((sum, item) => sum + item.discountAmount, 0),
    cart.subtotal,
  );

  return {
    appliedPromotions: computed.map(({ promotion, discount }) => ({
      promotionId: promotion.id,
      promoName: promotion.promoName,
      discountAmount: discount,
    })),
    totalDiscount: round(totalDiscount),
    itemBreakdown,
    grandTotal: round(cart.subtotal - totalDiscount),
  };
}
