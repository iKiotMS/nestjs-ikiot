/**
 * Lifecycle of a Product. Ported from the values iKiotMS-BE's ProductQueryDTO and
 * UpdateProductRequestDTO validated against — the old codebase never declared them in one
 * place, each DTO repeated the array.
 *
 * DISCONTINUED is the soft delete: order items, stock movements and inventory rows all
 * point at a product's variants, so rows are never removed. It is reachable only through
 * DELETE /products/:id, which additionally refuses while stock or pending paperwork exists.
 */
export const ProductStatus = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  DISCONTINUED: 'DISCONTINUED',
} as const;

export type ProductStatus = (typeof ProductStatus)[keyof typeof ProductStatus];

/** What a client may set directly — DISCONTINUED is reachable only via DELETE. */
export const SETTABLE_PRODUCT_STATUSES: readonly string[] = [
  ProductStatus.ACTIVE,
  ProductStatus.INACTIVE,
];

/** What a list endpoint may be filtered by. */
export const FILTERABLE_PRODUCT_STATUSES: readonly string[] = [
  ProductStatus.ACTIVE,
  ProductStatus.INACTIVE,
  ProductStatus.DISCONTINUED,
];

/**
 * Statuses that still count against the plan's `maxProducts` quota. A discontinued product
 * is not occupying a slot, same rule iKiotMS-BE's createProduct counted with.
 */
export const QUOTA_COUNTED_PRODUCT_STATUSES: readonly string[] = [
  ProductStatus.ACTIVE,
  ProductStatus.INACTIVE,
];
