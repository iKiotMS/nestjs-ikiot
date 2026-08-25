import { CREDIT_WARNING_RATIO } from './stock-movement.constants';

/**
 * Did this receipt just push a supplier's debt *through* the warning line?
 *
 * Edge-triggered, exactly like `crossedLowStock` in the inventory module and for the same
 * reason: a warning on every receipt once the supplier is near their limit is a warning
 * nobody reads. Fires only on the receipt that crosses.
 *
 * A credit limit of `0` (or less) means "no limit set", which is how the column is seeded —
 * there is nothing to warn about.
 *
 * @param debtAfter  outstanding debt once this receipt is booked
 * @param amount     what this receipt added (positive)
 * @param creditLimit the supplier's ceiling
 */
export function crossedCreditWarning(
  debtAfter: number,
  amount: number,
  creditLimit: number,
): boolean {
  if (creditLimit <= 0 || amount <= 0) return false;

  const threshold = CREDIT_WARNING_RATIO * creditLimit;
  return debtAfter >= threshold && debtAfter - amount < threshold;
}
