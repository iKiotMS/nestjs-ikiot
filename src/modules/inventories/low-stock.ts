import type { Inventory } from '../../../generated/prisma/client';

/** The two fields the rule actually reads, so callers can pass a partial row in tests. */
export type StockLevel = Pick<Inventory, 'stock' | 'minStock'>;

/**
 * Did this change just push a line *through* its low-stock threshold?
 *
 * Edge-triggered on purpose, and that is the whole point of the function. Warning whenever
 * `stock <= minStock` means every subsequent sale of an already-short item fires another
 * notification, and the manager mutes the channel on day one — so this reports only the
 * transition from above the threshold to at-or-below it.
 *
 * `minStock = 0` means the alert is switched off for that line.
 *
 * Kept as a free function rather than a method so it can be unit-tested without dragging
 * Prisma into the test — same reason `nextSubscriptionStatus` lives on its own.
 */
export function crossedLowStock<T extends StockLevel>(
  after: T | null,
  delta: number,
): T | null {
  if (!after || delta >= 0) return null;
  if (after.minStock <= 0) return null;

  const before = after.stock - delta; // delta is negative, so before > after.stock
  const crossed = before > after.minStock && after.stock <= after.minStock;
  return crossed ? after : null;
}
