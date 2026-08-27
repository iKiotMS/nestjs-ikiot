/** Where a holiday row came from. Persisted values — add, never rename. */
export const HolidaySource = {
  GOOGLE_CALENDAR: 'GOOGLE_CALENDAR',
  MANUAL: 'MANUAL',
} as const;

export const HOLIDAY_SOURCES = Object.values(HolidaySource);

/**
 * `PUBLIC_HOLIDAY` is the only type these routes touch — the old service hardcoded it in
 * every filter and every write. `COMPANY_HOLIDAY` exists in the schema for a per-branch
 * closure feature that was never built; nothing reads or writes it yet.
 */
export const HolidayType = {
  PUBLIC_HOLIDAY: 'PUBLIC_HOLIDAY',
  COMPANY_HOLIDAY: 'COMPANY_HOLIDAY',
} as const;

/**
 * A `YYYY-MM-DD` string as the UTC midnight a Postgres `date` column wants.
 *
 * The old service built these by hand (`new Date(\`${dto.date}T00:00:00.000Z\`)`) at every
 * call site. Keeping it in one place matters because the *whole* module keys on the date:
 * the unique index, the sync's "does this one already exist", and the year filter all have
 * to agree on what midnight means, and a local-time `new Date('2026-01-01')` is a
 * different instant depending on where the server sits.
 */
export function holidayDate(text: string): Date {
  return new Date(`${text}T00:00:00.000Z`);
}

/** The half-open UTC range covering one calendar year, for the `year` filter. */
export function yearRange(year: number): { gte: Date; lt: Date } {
  return {
    gte: new Date(Date.UTC(year, 0, 1)),
    lt: new Date(Date.UTC(year + 1, 0, 1)),
  };
}
