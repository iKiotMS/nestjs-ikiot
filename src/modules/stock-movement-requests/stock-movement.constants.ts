/**
 * What a stock movement is for.
 *
 * - `IMPORT` — goods arriving from a supplier. The only type with a `fromSupplier` and the
 *   only one that moves the supplier's outstanding debt.
 * - `EXPORT` — stock leaving one of our locations for another of our locations.
 * - `RETURN` — the same physical move in the other direction (a branch sending stock back
 *   to a warehouse). Kept as its own type because the paperwork and the reporting differ.
 * - `ADJUST` — a stocktake: no goods move, the recorded number is corrected to the counted
 *   one at a single location.
 */
export const MovementType = {
  IMPORT: 'IMPORT',
  EXPORT: 'EXPORT',
  RETURN: 'RETURN',
  ADJUST: 'ADJUST',
} as const;

export type MovementType = (typeof MovementType)[keyof typeof MovementType];

export const MOVEMENT_TYPES: readonly string[] = Object.values(MovementType);

/**
 * The lifecycle of a request.
 *
 * `DRAFT → OPENING → CLOSED → IN_TRANSIT → RECEIVED` is the transfer path; IMPORT and
 * ADJUST start at `PENDING` instead, because there is nothing to pick and pack — an import
 * is waiting on the supplier's van and an adjustment is waiting on someone to approve the
 * count. `ADJUST` finishes at `COMPLETED` rather than `RECEIVED`, since nothing arrived.
 */
export const MovementStatus = {
  DRAFT: 'DRAFT',
  PENDING: 'PENDING',
  OPENING: 'OPENING',
  CLOSED: 'CLOSED',
  IN_TRANSIT: 'IN_TRANSIT',
  RECEIVED: 'RECEIVED',
  CANCELLED: 'CANCELLED',
  COMPLETED: 'COMPLETED',
} as const;

export type MovementStatus =
  (typeof MovementStatus)[keyof typeof MovementStatus];

export const MOVEMENT_STATUSES: readonly string[] =
  Object.values(MovementStatus);

/**
 * Statuses in which a movement still expects to touch its items. `ProductService` reads
 * this to refuse discontinuing a product caught up in unfinished paperwork.
 */
export const OPEN_MOVEMENT_STATUSES: readonly string[] = [
  MovementStatus.DRAFT,
  MovementStatus.PENDING,
  MovementStatus.OPENING,
  MovementStatus.IN_TRANSIT,
];

/** Nothing moves a request out of these — cancelling one is refused. */
export const FINAL_MOVEMENT_STATUSES: readonly string[] = [
  MovementStatus.RECEIVED,
  MovementStatus.COMPLETED,
  MovementStatus.CANCELLED,
];

/**
 * How much of a supplier's credit limit has to be used before the owners are warned.
 * Ported from the hardcoded `0.75` in iKiotMS-BE's receive path — the warning fires once,
 * on the receipt that crosses the line, not on every receipt above it.
 */
export const CREDIT_WARNING_RATIO = 0.75;
