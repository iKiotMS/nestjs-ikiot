import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { HttpException, HttpStatus } from '@nestjs/common';

/** Ported from `geolocationConstants.js`. */
export const EARTH_RADIUS_METERS = 6_371_000;

export const VerificationStatus = {
  VERIFIED: 'VERIFIED',
  LOW_ACCURACY: 'LOW_ACCURACY',
  OUT_OF_RANGE: 'OUT_OF_RANGE',
  NO_LOCATION: 'NO_LOCATION',
} as const;

/** Defaults the old service applied when a location left them unset. */
const DEFAULT_ALLOWED_RADIUS_METERS = 100;
const DEFAULT_MAX_ACCURACY_METERS = 100;

export interface GeoPoint {
  latitude: number;
  longitude: number;
  accuracy: number;
}

/** The geofence configured on a branch or warehouse. */
export interface GeoFence {
  latitude: number | null;
  longitude: number | null;
  allowedRadiusMeters: number | null;
  maxAccuracyMeters: number | null;
}

export interface GeoVerdict {
  verificationStatus: string;
  distance: number;
  allowedRadiusMeters: number;
  maxAccuracyMeters: number;
}

/**
 * Great-circle distance in metres — the Haversine formula, ported verbatim.
 *
 * Straight-line over the Earth's surface, which is the right measure for "is this person
 * standing at the shop": walking distance would be larger and is not what a radius means.
 */
export function distanceInMeters(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

  const deltaLat = toRadians(to.latitude - from.latitude);
  const deltaLong = toRadians(to.longitude - from.longitude);

  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(from.latitude)) *
      Math.cos(toRadians(to.latitude)) *
      Math.sin(deltaLong / 2) ** 2;

  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Is this person close enough, and is their fix trustworthy enough, to clock in?
 *
 * **Two failures with different meanings, and the old service kept them apart on purpose:**
 * a 422 for a GPS fix too vague to judge (`LOW_ACCURACY` — the phone doesn't know where it
 * is, which is not the employee's fault and is worth retrying), and a 403 for a fix that is
 * good enough and says they are somewhere else (`OUT_OF_RANGE`). Collapsing them would tell
 * someone standing in the shop that they are not allowed to be there.
 *
 * Accuracy is checked first for the same reason: a vague fix that happens to land far away
 * is a bad fix, not a distant employee.
 */
export function verifyWithinFence(
  fence: GeoFence,
  point: GeoPoint,
): GeoVerdict {
  if (fence.latitude === null || fence.longitude === null) {
    throw new BadRequestException('Địa điểm chấm công chưa được cấu hình');
  }

  const allowedRadiusMeters =
    fence.allowedRadiusMeters ?? DEFAULT_ALLOWED_RADIUS_METERS;
  const maxAccuracyMeters =
    fence.maxAccuracyMeters ?? DEFAULT_MAX_ACCURACY_METERS;
  const distance = distanceInMeters(point, {
    latitude: fence.latitude,
    longitude: fence.longitude,
  });

  if (point.accuracy > maxAccuracyMeters) {
    throw new HttpException(
      {
        message: `Độ chính xác của vị trí (${point.accuracy}m) không đủ để chấm công`,
        errors: {
          verificationStatus: VerificationStatus.LOW_ACCURACY,
          accuracy: point.accuracy,
          maxAccuracyMeters,
          distance,
          allowedRadiusMeters,
        },
      },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }

  if (distance > allowedRadiusMeters) {
    throw new ForbiddenException({
      message: 'Bạn đang ở ngoài khu vực chấm công cho phép',
      errors: {
        verificationStatus: VerificationStatus.OUT_OF_RANGE,
        accuracy: point.accuracy,
        maxAccuracyMeters,
        distance,
        allowedRadiusMeters,
      },
    });
  }

  return {
    verificationStatus: VerificationStatus.VERIFIED,
    distance,
    allowedRadiusMeters,
    maxAccuracyMeters,
  };
}
