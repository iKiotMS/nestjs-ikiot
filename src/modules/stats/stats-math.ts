import { DEFAULT_RANGE_DAYS, MS_PER_DAY, TZ_OFFSET } from './stats.constants';

/**
 * The arithmetic behind every dashboard number, as pure functions — same shape as
 * `pricing-engine.ts` and `payroll-math.ts`, and for the same reason: these are the rules a
 * shop owner will argue with, so they need to be readable and testable without a database.
 *
 * Ported from iKiotMS-BE's `StatsQueryDTO` (range parsing) and the `pct`/`aov` expressions
 * that were repeated inline across `StatsService` and `AdminStatsService`.
 */

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export interface DateRange {
  fromDate: Date;
  toDate: Date;
}

/**
 * A bare `YYYY-MM-DD` means a whole local day, so which end of the range it is decides
 * whether it becomes midnight or the last millisecond. Anything else is handed to `Date`
 * as-is, which is how a full ISO timestamp keeps its own offset.
 */
export function parseBoundary(raw: string, endOfDay: boolean): Date {
  if (DATE_ONLY.test(raw)) {
    const time = endOfDay ? '23:59:59.999' : '00:00:00.000';
    return new Date(`${raw}T${time}${TZ_OFFSET}`);
  }
  return new Date(raw);
}

/** Defaults: ending now, starting 30 days earlier. */
export function resolveRange(rawFrom?: string, rawTo?: string): DateRange {
  const toDate = rawTo ? parseBoundary(rawTo, true) : new Date();
  const fromDate = rawFrom
    ? parseBoundary(rawFrom, false)
    : new Date(toDate.getTime() - DEFAULT_RANGE_DAYS * MS_PER_DAY);
  return { fromDate, toDate };
}

/**
 * The equal-length window immediately before the one asked for — what every `changePct` is
 * measured against.
 *
 * Both windows are inclusive at both ends, so each is `span + 1` ms wide and they touch
 * without overlapping: the previous one ends 1 ms before `fromDate`. Comparing a 30-day
 * range against a 29-day one would make every percentage subtly wrong, which is why the
 * `- 1`s are not decoration.
 */
export function previousPeriod({ fromDate, toDate }: DateRange): DateRange {
  const span = toDate.getTime() - fromDate.getTime();
  return {
    fromDate: new Date(fromDate.getTime() - span - 1),
    toDate: new Date(fromDate.getTime() - 1),
  };
}

/**
 * Period-over-period change, to one decimal place.
 *
 * `null` when the previous period was zero — not `0`, and not `Infinity`. There is no
 * honest percentage for "went from nothing to something", and answering 0 would read on the
 * dashboard as "flat", which is the opposite of what happened. The client renders the null
 * as a dash.
 */
export function changePct(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/** Average order value, rounded to whole đồng — VND has no minor unit. */
export function averageOrderValue(revenue: number, orderCount: number): number {
  return orderCount === 0 ? 0 : Math.round(revenue / orderCount);
}

/** A ratio as a percentage to one decimal, `null` when there is nothing to divide by. */
export function ratioPct(part: number, whole: number): number | null {
  if (whole === 0) return null;
  return Math.round((part / whole) * 1000) / 10;
}

/** `[{ status, count }]` → `{ status: count }`, the shape every summary block wants. */
export function countByKey<K extends string>(
  rows: { key: K | null; count: number }[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    if (row.key === null) continue;
    out[row.key] = (out[row.key] ?? 0) + row.count;
  }
  return out;
}
