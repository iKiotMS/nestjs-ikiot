/**
 * `ShiftTemplate.startTime`/`endTime` are `@db.Time` columns, upgraded from the plain
 * `"08:00"` strings the Mongo model stored. The API still speaks `HH:mm`, so this file is
 * the only place that maps between the two.
 *
 * Prisma hands a `time` column back as a `Date` on 1970-01-01 with the time-of-day in
 * **UTC**, and expects the same going in. Reading it with `getHours()` would apply the
 * server's timezone and shift every shift template by the UTC offset — in Vietnam that
 * turns an 08:00 shift into 15:00. Everything here is deliberately UTC.
 */

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export const SHIFT_TIME_MESSAGE = 'Giờ phải có định dạng HH:mm';

export function isShiftTime(value: string): boolean {
  return TIME_PATTERN.test(value);
}

/** `"08:00"` → the Date a `@db.Time` column wants. */
export function toShiftTime(text: string): Date {
  const [hour, minute] = text.split(':').map(Number);
  return new Date(Date.UTC(1970, 0, 1, hour, minute, 0, 0));
}

/** A `@db.Time` column → `"08:00"`. */
export function fromShiftTime(value: Date | null): string | null {
  if (!value) return null;
  const hour = String(value.getUTCHours()).padStart(2, '0');
  const minute = String(value.getUTCMinutes()).padStart(2, '0');
  return `${hour}:${minute}`;
}

/**
 * Minutes past midnight, for comparing a start against an end without going through
 * strings. `"22:00" > "06:00"` happens to be true lexicographically for zero-padded
 * `HH:mm`, which is how the old code compared them — this says it out loud instead.
 */
export function shiftMinutes(value: Date): number {
  return value.getUTCHours() * 60 + value.getUTCMinutes();
}
