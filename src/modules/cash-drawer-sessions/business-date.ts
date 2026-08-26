import { BUSINESS_TIMEZONE } from './cash-drawer.constants';

/**
 * Which trading day an instant belongs to, in the shop's own timezone.
 *
 * Returned as midnight UTC of that calendar day, which is how a Postgres `date` column
 * wants it — the value is a day, not a moment, and pinning it to UTC midnight keeps it from
 * drifting a day either way when it is read back.
 *
 * Doing this in UTC instead would put every drawer opened before 07:00 local onto the
 * previous day's takings. Pure, and tested, because that failure is invisible until
 * somebody reconciles a till and the numbers are off by one shift.
 *
 * Ported from iKiotMS-BE's `CashDrawerService.businessDate`, which returned a
 * `YYYY-MM-DD` string; the column is a real date here.
 */
export function businessDate(
  at: Date = new Date(),
  timeZone: string = BUSINESS_TIMEZONE,
): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);

  const value = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  ) as Record<string, string>;

  return new Date(
    Date.UTC(Number(value.year), Number(value.month) - 1, Number(value.day)),
  );
}

/** `YYYY-MM-DD`, for messages and for comparing two business dates in a log line. */
export function formatBusinessDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
