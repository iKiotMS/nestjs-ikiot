/**
 * Which kind of location a polymorphic reference points at.
 *
 * Lowercase on purpose: these exact strings are what iKiotMS-BE put on the wire
 * (`locationType: "branch" | "warehouse"`), and the frontend still sends and reads them.
 * In Postgres the same reference is a pair of nullable FKs instead — see
 * `src/common/dto/location-ref.dto.ts`, which is the only place that maps between the two.
 */
export const LocationType = {
  BRANCH: 'branch',
  WAREHOUSE: 'warehouse',
} as const;

export type LocationType = (typeof LocationType)[keyof typeof LocationType];

export const LOCATION_TYPES: readonly string[] = Object.values(LocationType);
