import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  ValidateIf,
} from 'class-validator';
import { LocationType, LOCATION_TYPES } from '../constants/location-type';

/**
 * A reference to "a branch or a warehouse", in the shape the API speaks.
 *
 * Mongo stored this as `locationId` + `locationType`; Postgres stores it as a pair of
 * nullable foreign keys (`branch_id` / `warehouse_id`), because a real FK is the only way
 * the database can stop an inventory row pointing at a branch that doesn't exist. The API
 * keeps the old pair so the frontend needs no change — the same trade the geofence makes
 * in `attendance-location.dto.ts`.
 *
 * This file is the one place that maps between the two. Don't expose `branchId`/
 * `warehouseId` from a controller, and don't rebuild the mapping at a call site.
 */
export class LocationRefDto {
  @IsUUID()
  @IsNotEmpty({ message: 'Thiếu địa điểm' })
  locationId: string;

  @IsIn(LOCATION_TYPES, {
    message: `locationType phải là ${LOCATION_TYPES.join(' hoặc ')}`,
  })
  locationType: string;
}

/**
 * The same reference as a filter: both fields may be absent, but naming a location without
 * saying which kind it is never resolves — branch and warehouse ids come from different
 * tables, so the same uuid could legitimately exist in both.
 */
export class LocationRefQueryDto {
  @IsOptional()
  @IsUUID()
  locationId?: string;

  // Not @IsOptional(): once either field is present, locationType has to be a real value.
  @ValidateIf(
    (q: LocationRefQueryDto) =>
      q.locationId !== undefined || q.locationType !== undefined,
  )
  @IsIn(LOCATION_TYPES, {
    message: `locationType phải là ${LOCATION_TYPES.join(' hoặc ')} (bắt buộc khi có locationId)`,
  })
  locationType?: string;
}

/** The pair of nullable FKs as Prisma writes them. Exactly one is ever set. */
export interface LocationColumns {
  branchId: string | null;
  warehouseId: string | null;
}

/** Nested request shape -> flat columns, for a write. */
export function toLocationColumns(ref: LocationRefDto): LocationColumns {
  return ref.locationType === LocationType.BRANCH
    ? { branchId: ref.locationId, warehouseId: null }
    : { branchId: null, warehouseId: ref.locationId };
}

/** Flat columns -> the API's pair. Null when the row somehow names neither. */
export function toLocationRef(row: {
  branchId: string | null;
  warehouseId: string | null;
}): { locationId: string; locationType: LocationType } | null {
  if (row.branchId) {
    return { locationId: row.branchId, locationType: LocationType.BRANCH };
  }
  if (row.warehouseId) {
    return {
      locationId: row.warehouseId,
      locationType: LocationType.WAREHOUSE,
    };
  }
  return null;
}

/**
 * The same reference as a Prisma `where` fragment, for a read.
 *
 * Spread it into a filter — it contributes nothing when neither field was given, narrows to
 * one location when both were, and narrows to "any branch" / "any warehouse" when only the
 * type was. iKiotMS-BE allowed all three combinations and the frontend uses each of them.
 */
export function locationWhere(query: LocationRefQueryDto): {
  branchId?: string | { not: null };
  warehouseId?: string | { not: null };
} {
  const { locationId, locationType } = query;
  if (locationId) {
    // locationType is guaranteed present here by LocationRefQueryDto's validation.
    return locationType === LocationType.WAREHOUSE
      ? { warehouseId: locationId }
      : { branchId: locationId };
  }
  if (locationType === LocationType.BRANCH) return { branchId: { not: null } };
  if (locationType === LocationType.WAREHOUSE) {
    return { warehouseId: { not: null } };
  }
  return {};
}

/**
 * The same pair again, under the `from`/`to` prefixes `StockMovementRequest` uses. A
 * movement names two locations, so it carries two copies of the columns; these keep the
 * mapping in this file rather than spelling out `fromBranchId`/`fromWarehouseId` at every
 * call site in StockMovementService.
 */
export function toSourceColumns(ref: LocationRefDto): {
  fromBranchId: string | null;
  fromWarehouseId: string | null;
} {
  const { branchId, warehouseId } = toLocationColumns(ref);
  return { fromBranchId: branchId, fromWarehouseId: warehouseId };
}

export function toDestinationColumns(ref: LocationRefDto): {
  toBranchId: string | null;
  toWarehouseId: string | null;
} {
  const { branchId, warehouseId } = toLocationColumns(ref);
  return { toBranchId: branchId, toWarehouseId: warehouseId };
}

export function sourceRef(row: {
  fromBranchId: string | null;
  fromWarehouseId: string | null;
}) {
  return toLocationRef({
    branchId: row.fromBranchId,
    warehouseId: row.fromWarehouseId,
  });
}

export function destinationRef(row: {
  toBranchId: string | null;
  toWarehouseId: string | null;
}) {
  return toLocationRef({
    branchId: row.toBranchId,
    warehouseId: row.toWarehouseId,
  });
}
