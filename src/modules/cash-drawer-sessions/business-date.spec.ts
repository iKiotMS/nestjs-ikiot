import { businessDate, formatBusinessDate } from './business-date';

const iso = (at: string) => formatBusinessDate(businessDate(new Date(at)));

// Ho Chi Minh City is UTC+7 all year — no daylight saving to complicate the boundary.
// Getting this wrong puts an early-morning drawer onto the previous day's takings, which
// nobody notices until a till is reconciled and it is short by a whole shift.
describe('businessDate', () => {
  it('uses the shop local day, not the UTC day', () => {
    // 17:30 UTC is already 00:30 the next morning in Vietnam.
    expect(iso('2026-08-26T17:30:00.000Z')).toBe('2026-08-27');
  });

  it('keeps late-evening local time on the same day', () => {
    // 16:59 UTC is 23:59 local — still the 26th.
    expect(iso('2026-08-26T16:59:00.000Z')).toBe('2026-08-26');
  });

  it('rolls over exactly at local midnight', () => {
    expect(iso('2026-08-26T16:59:59.999Z')).toBe('2026-08-26');
    expect(iso('2026-08-26T17:00:00.000Z')).toBe('2026-08-27');
  });

  it('handles a day that UTC has not started yet', () => {
    // 01:00 local on the 1st is 18:00 UTC on the previous month's last day.
    expect(iso('2026-08-31T18:00:00.000Z')).toBe('2026-09-01');
  });

  it('returns midnight UTC so a date column round-trips unchanged', () => {
    const value = businessDate(new Date('2026-08-26T09:15:00.000Z'));
    expect(value.toISOString()).toBe('2026-08-26T00:00:00.000Z');
  });

  it('honours a different timezone when one is given', () => {
    expect(
      formatBusinessDate(
        businessDate(new Date('2026-08-26T23:30:00.000Z'), 'UTC'),
      ),
    ).toBe('2026-08-26');
  });
});
