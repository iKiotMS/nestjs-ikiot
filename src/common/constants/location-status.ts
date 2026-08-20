/**
 * Lifecycle of a physical location (Branch, Warehouse). Ported from iKiotMS-BE's
 * branchConstants.js / warehouseConstants.js, which declared the same three values twice.
 *
 * DELETED is a soft delete: rows are never removed, because users, orders, inventory,
 * stock movements and cash flows all point at them. It is reachable only through the
 * DELETE route — never accepted as a value on create or update.
 */
export const LocationStatus = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  DELETED: 'DELETED',
} as const;

export type LocationStatus =
  (typeof LocationStatus)[keyof typeof LocationStatus];

/** What a client may set directly. */
export const SETTABLE_LOCATION_STATUSES: readonly string[] = [
  LocationStatus.ACTIVE,
  LocationStatus.INACTIVE,
];

/** What a list endpoint may be filtered by. */
export const FILTERABLE_LOCATION_STATUSES: readonly string[] = [
  LocationStatus.ACTIVE,
  LocationStatus.INACTIVE,
  LocationStatus.DELETED,
];
