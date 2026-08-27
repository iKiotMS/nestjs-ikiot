/**
 * Leave is counted in whole calendar days, so every date in this module is the UTC
 * midnight a Postgres `date` column stores — ported from the old service's `buildWorkDate`.
 *
 * Kept separate from `working-schedules/schedule-time.ts` on purpose: that file converts
 * *times* at Vietnam's offset because a shift starts at a wall-clock hour. A leave day has
 * no hour, so applying an offset to it would shift the boundary and make a one-day leave
 * span two dates.
 */
export function leaveDate(value: Date | string): Date {
  const text =
    typeof value === 'string'
      ? value.slice(0, 10)
      : value.toISOString().slice(0, 10);
  return new Date(`${text}T00:00:00.000Z`);
}

/** The day after — an exclusive upper bound for a range query. */
export function nextDay(value: Date): Date {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

/**
 * Whole days from start to end, both ends **inclusive** — one day off is 1, not 0.
 *
 * Ported verbatim, including that inclusivity: it is what `paidLeaveDays +
 * unpaidLeaveDays` is checked against when a request is approved.
 */
export function leaveDayCount(start: Date, end: Date): number {
  const from = leaveDate(start);
  const to = leaveDate(end);
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1;
}
