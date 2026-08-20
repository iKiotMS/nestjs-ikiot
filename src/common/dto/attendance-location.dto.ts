import { Type } from 'class-transformer';
import { IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';

/**
 * The geofence a branch or warehouse takes attendance inside.
 *
 * The DB stores these flattened (`attendance_latitude`, …) because the source Mongoose
 * subdocument had a fixed shape — see the schema header. The API keeps the nested
 * `attendanceTakingLocation` object that iKiotMS-BE exposed, so the existing frontend
 * needs no change; the services map between the two.
 */
export class AttendanceLocationDto {
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  allowedRadiusMeters?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxAccuracyMeters?: number;
}

/** The four flattened columns as Prisma writes them. */
export interface AttendanceLocationColumns {
  attendanceLatitude?: number | null;
  attendanceLongitude?: number | null;
  attendanceAllowedRadiusMeters?: number | null;
  attendanceMaxAccuracyMeters?: number | null;
}

/**
 * Nested request shape -> flat columns. Returns `{}` when the caller omitted the object
 * entirely, so a PATCH that doesn't mention the geofence leaves it alone.
 */
export function toAttendanceColumns(
  location?: AttendanceLocationDto,
): AttendanceLocationColumns {
  if (!location) return {};
  return {
    attendanceLatitude: location.latitude,
    attendanceLongitude: location.longitude,
    attendanceAllowedRadiusMeters: location.allowedRadiusMeters,
    attendanceMaxAccuracyMeters: location.maxAccuracyMeters,
  };
}

/** A DB row carrying the four flattened columns. */
export interface AttendanceLocationRow {
  attendanceLatitude: number | null;
  attendanceLongitude: number | null;
  attendanceAllowedRadiusMeters: number | null;
  attendanceMaxAccuracyMeters: number | null;
}

/**
 * Flat columns -> nested response shape. Null when no coordinates were ever set, matching
 * the old API where the subdocument was simply absent.
 */
export function toAttendanceLocation(
  row: AttendanceLocationRow,
): AttendanceLocationDto | null {
  if (row.attendanceLatitude === null && row.attendanceLongitude === null) {
    return null;
  }
  return {
    latitude: row.attendanceLatitude ?? undefined,
    longitude: row.attendanceLongitude ?? undefined,
    allowedRadiusMeters: row.attendanceAllowedRadiusMeters ?? undefined,
    maxAccuracyMeters: row.attendanceMaxAccuracyMeters ?? undefined,
  };
}

/**
 * Turns a row into its API representation: the four flat columns are dropped and replaced
 * by the nested `attendanceTakingLocation` object.
 *
 * The four names are destructured purely to leave them out of `rest` — eslint's
 * `ignoreRestSiblings` is what makes that read as intentional rather than as four unused
 * variables. TypeScript infers the return type (`Omit<T, ...> & { ... }`) from the
 * destructure, so it stays correct on its own if a column is ever added or renamed.
 */
export function withNestedAttendanceLocation<T extends AttendanceLocationRow>(
  row: T,
) {
  const {
    attendanceLatitude,
    attendanceLongitude,
    attendanceAllowedRadiusMeters,
    attendanceMaxAccuracyMeters,
    ...rest
  } = row;

  return { ...rest, attendanceTakingLocation: toAttendanceLocation(row) };
}
