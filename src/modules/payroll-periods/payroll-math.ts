/**
 * Every rule that decides how much somebody is paid, as pure functions.
 *
 * Ported from iKiotMS-BE's `PayrollDayRateCalculator` and the calculation half of
 * `PayrollService`. **No database access, by design** — the service loads the shifts,
 * attendances, leave and holidays and hands them in. That separation is what makes payroll
 * testable: every number below is one an employee will eventually query, and none of them
 * needs a connection to check.
 *
 * Same shape as `promotions/pricing-engine.ts`, and for the same reason.
 */

const MINUTES_PER_HOUR = 60;

/** What kind of day a shift falls on. Drives both the base and the overtime multiplier. */
export const DayType = {
  NORMAL: 'NORMAL',
  WEEKEND: 'WEEKEND',
  HOLIDAY: 'HOLIDAY',
  WEEKEND_HOLIDAY: 'WEEKEND_HOLIDAY',
} as const;

export const PayType = {
  PAY_BY_SHIFT: 'PAY_BY_SHIFT',
  STANDARD_WORKING_DAY: 'STANDARD_WORKING_DAY',
  FIXED: 'FIXED',
} as const;

export const ScheduleKind = { NORMAL: 'NORMAL', OVERTIME: 'OVERTIME' } as const;

export interface PayrollSettings {
  standardWorkingDays: number;
  standardWorkingHoursPerDay: number;
  /** Day-of-week numbers (0 = Sunday) that count as a weekend. */
  weekendDays: number[];
  lateGraceMinutes: number;
}

/** The pay rules attached to an employee, flattened from their Paysheet. */
export interface PaysheetRates {
  payType: string | null;
  amountPerShift: number;
  salaryPerPeriod: number;
  standardWorkingDaySalary: number;
  baseWeekend: number;
  basePublicHoliday: number;
  overtimeNormalDay: number;
  overtimeWeekend: number;
  overtimePublicHoliday: number;
}

export interface SchedulePeriod {
  id: string;
  scheduleType: string;
  workDate: string;
  startAt: Date;
  endAt: Date;
}

export interface AttendanceSpan {
  scheduleId: string | null;
  actualCheckinAt: Date | null;
  actualCheckoutAt: Date | null;
  lateMinutes: number | null;
}

/** A shift with the minutes payroll will actually pay for worked out. */
export interface PayableSchedule extends SchedulePeriod {
  actualWorkedMinutes: number;
  payableMinutes: number;
}

export interface PayLine {
  scheduleId: string;
  scheduleType: string;
  dayType: string;
  rate: number;
  scheduledMinutes: number;
  payableMinutes: number;
  amount: number;
  holidayName: string | null;
}

/** A public holiday, as payroll sees it. */
export interface PayrollHoliday {
  name: string;
  type: string;
}

// ─── Day classification ──────────────────────────────────────────────────────

export function dateKeyOf(value: Date | string): string {
  return typeof value === 'string'
    ? value.slice(0, 10)
    : value.toISOString().slice(0, 10);
}

/**
 * **Only `PUBLIC_HOLIDAY` counts for pay.** A `COMPANY_HOLIDAY` is the shop's own closure
 * and carries no statutory multiplier — the old calculator filtered it out explicitly
 * before doing anything else, and paying a holiday rate for one would be inventing money.
 */
export function payrollHolidayOf(
  holiday: PayrollHoliday | null | undefined,
): PayrollHoliday | null {
  return holiday?.type === 'PUBLIC_HOLIDAY' ? holiday : null;
}

export function dayTypeOf(
  workDate: Date | string,
  holiday: PayrollHoliday | null,
  weekendDays: number[],
): string {
  const day = new Date(`${dateKeyOf(workDate)}T00:00:00.000Z`).getUTCDay();
  const weekend = weekendDays.includes(day);
  const publicHoliday = payrollHolidayOf(holiday) !== null;

  if (weekend && publicHoliday) return DayType.WEEKEND_HOLIDAY;
  if (weekend) return DayType.WEEKEND;
  if (publicHoliday) return DayType.HOLIDAY;
  return DayType.NORMAL;
}

/**
 * **A public holiday outranks a weekend** when both fall on the same day — the higher of
 * the two rates applies, not both and not the weekend one. Ported verbatim.
 */
function rateKindOf(
  dayType: string,
  holiday: PayrollHoliday | null,
): 'weekend' | 'publicHoliday' | null {
  if (payrollHolidayOf(holiday)) return 'publicHoliday';
  if (dayType === DayType.WEEKEND) return 'weekend';
  return null;
}

export function basePayRate(
  rates: PaysheetRates,
  dayType: string,
  holiday: PayrollHoliday | null,
): number {
  const kind = rateKindOf(dayType, holiday);
  if (!kind) return 1;
  return kind === 'weekend' ? rates.baseWeekend : rates.basePublicHoliday;
}

export function overtimePayRate(
  rates: PaysheetRates,
  dayType: string,
  holiday: PayrollHoliday | null,
): number {
  const kind = rateKindOf(dayType, holiday);
  if (!kind) return rates.overtimeNormalDay;
  return kind === 'weekend'
    ? rates.overtimeWeekend
    : rates.overtimePublicHoliday;
}

// ─── Time on the clock ───────────────────────────────────────────────────────

export function scheduleMinutes(schedule: SchedulePeriod): number {
  const start = schedule.startAt.getTime();
  const end = schedule.endAt.getTime();
  return end <= start ? 0 : Math.floor((end - start) / 60_000);
}

/** Merges overlapping intervals so shared time is counted once. */
function mergeRanges(
  ranges: { start: number; end: number }[],
): { start: number; end: number }[] {
  const valid = ranges
    .filter((range) => range.end > range.start)
    .sort((a, b) => a.start - b.start);

  const merged: { start: number; end: number }[] = [];
  for (const range of valid) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

/**
 * The attendance rows that belong to a shift.
 *
 * Matched on `scheduleId` first. The fallback — any attendance whose clock-in window
 * overlaps the shift — exists for rows written before `scheduleId` was recorded, and is
 * deliberately narrow: without the overlap test it would pick up a *different* shift on
 * the same day and pay for it twice.
 */
export function attendancesForSchedule(
  schedule: SchedulePeriod,
  attendances: AttendanceSpan[],
): AttendanceSpan[] {
  const byId = attendances.filter(
    (attendance) => attendance.scheduleId === schedule.id,
  );
  if (byId.length > 0) return byId;

  const start = schedule.startAt.getTime();
  const end = schedule.endAt.getTime();
  return attendances.filter((attendance) => {
    if (!attendance.actualCheckinAt) return false;
    const checkin = attendance.actualCheckinAt.getTime();
    const checkout = attendance.actualCheckoutAt?.getTime() ?? checkin;
    return checkin < end && checkout > start;
  });
}

/**
 * Minutes actually worked *inside* a shift's window.
 *
 * Clipped to the shift at both ends: arriving at 07:30 for an 08:00 shift does not earn
 * from 07:30, and staying past the end is overtime only if it was rostered as one.
 * Attendance rows are merged first so two overlapping ones can't be paid twice.
 */
export function payableMinutesOf(
  schedule: SchedulePeriod,
  attendances: AttendanceSpan[],
): number {
  const start = schedule.startAt.getTime();
  const end = schedule.endAt.getTime();

  const ranges = attendances
    .filter((a) => a.actualCheckinAt && a.actualCheckoutAt)
    .map((a) => ({
      start: Math.max(a.actualCheckinAt!.getTime(), start),
      end: Math.min(a.actualCheckoutAt!.getTime(), end),
    }));

  return mergeRanges(ranges).reduce(
    (total, range) => total + Math.floor((range.end - range.start) / 60_000),
    0,
  );
}

/**
 * How late the person was for a shift, both raw and after the grace period.
 *
 * **Prefers the stored `lateMinutes`** and derives it only when absent — the same
 * "stored wins, else derive" the old service used, which is what lets rows written before
 * check-in started recording it still produce the right answer.
 *
 * Overtime shifts are never late: there is no expectation to be early to one.
 */
export function scheduleLateInfo(
  schedule: SchedulePeriod,
  attendances: AttendanceSpan[],
  graceMinutes: number,
): { rawMinutes: number; violationMinutes: number } {
  if (schedule.scheduleType === ScheduleKind.OVERTIME) {
    return { rawMinutes: 0, violationMinutes: 0 };
  }

  const checkedIn = attendancesForSchedule(schedule, attendances).filter(
    (a) => a.actualCheckinAt,
  );
  if (checkedIn.length === 0) return { rawMinutes: 0, violationMinutes: 0 };

  // The earliest check-in is the one that decides lateness — arriving twice doesn't make
  // you later.
  const earliest = checkedIn.reduce((first, attendance) =>
    attendance.actualCheckinAt!.getTime() < first.actualCheckinAt!.getTime()
      ? attendance
      : first,
  );
  const rawMinutes = Math.max(
    0,
    Math.floor(
      (earliest.actualCheckinAt!.getTime() - schedule.startAt.getTime()) /
        60_000,
    ),
  );

  const stored = earliest.lateMinutes;
  const violationMinutes =
    stored !== null && Number.isFinite(stored)
      ? Math.max(0, stored)
      : rawMinutes <= graceMinutes
        ? 0
        : rawMinutes;

  return { rawMinutes, violationMinutes };
}

/**
 * Minutes left before the shift ended.
 *
 * The **latest** checkout is used, not the first: clocking out and back in again shouldn't
 * be counted as leaving early twice.
 */
export function scheduleEarlyLeaveMinutes(
  schedule: SchedulePeriod,
  attendances: AttendanceSpan[],
): number {
  if (schedule.scheduleType === ScheduleKind.OVERTIME) return 0;

  const checkedOut = attendancesForSchedule(schedule, attendances).filter(
    (a) => a.actualCheckoutAt,
  );
  if (checkedOut.length === 0) return 0;

  const latest = Math.max(
    ...checkedOut.map((a) => a.actualCheckoutAt!.getTime()),
  );
  return Math.max(0, Math.floor((schedule.endAt.getTime() - latest) / 60_000));
}

/**
 * Turns rostered shifts into payable ones, and drops the shifts nobody turned up to.
 *
 * **The restoration rules are the subtle part, and they exist so nobody is punished
 * twice.** When a late-penalty rule is active, the *whole* shortfall caused by arriving
 * late is added back to the payable minutes, because the money is taken by the penalty
 * instead — deducting the time as well would charge for the same lateness twice. When no
 * such rule is configured, only the minutes inside the grace period come back; the
 * violation still reduces pay by the time it cost. Early leaving works the same way.
 *
 * Capped at the shift's own length: restorations must never pay for more than the shift.
 */
export function toPayableSchedules(
  schedules: SchedulePeriod[],
  attendances: AttendanceSpan[],
  options: {
    hasLatePenalty: boolean;
    hasEarlyLeavePenalty: boolean;
    graceMinutes: number;
  },
): PayableSchedule[] {
  return schedules
    .map((schedule) => {
      const own = attendancesForSchedule(schedule, attendances);
      const actualWorkedMinutes = payableMinutesOf(schedule, own);
      const { rawMinutes, violationMinutes } = scheduleLateInfo(
        schedule,
        attendances,
        options.graceMinutes,
      );

      const restoredLate = options.hasLatePenalty
        ? rawMinutes
        : Math.max(0, rawMinutes - violationMinutes);
      const restoredEarly = options.hasEarlyLeavePenalty
        ? scheduleEarlyLeaveMinutes(schedule, attendances)
        : 0;

      return {
        ...schedule,
        actualWorkedMinutes,
        payableMinutes: Math.min(
          scheduleMinutes(schedule),
          actualWorkedMinutes + restoredLate + restoredEarly,
        ),
      };
    })
    .filter((schedule) => schedule.actualWorkedMinutes > 0);
}

// ─── Pay per shift ───────────────────────────────────────────────────────────

/**
 * What one shift is worth.
 *
 * **A `FIXED` employee's normal shifts produce a line worth zero on purpose.** Their period
 * salary is pro-rated across the whole period afterwards, in `fixedWorkedPay` — doing it
 * per shift here would make it impossible to cap a day at one day's pay when somebody works
 * two shifts. The line is still emitted so the payslip can show the day.
 */
export function schedulePay(
  schedule: PayableSchedule,
  rates: PaysheetRates,
  holiday: PayrollHoliday | null,
  settings: PayrollSettings,
): PayLine {
  const payrollHoliday = payrollHolidayOf(holiday);
  const dayType = dayTypeOf(
    schedule.workDate,
    payrollHoliday,
    settings.weekendDays,
  );
  const scheduled = scheduleMinutes(schedule);
  const payable = Math.max(0, schedule.payableMinutes);
  const workedRatio = scheduled ? payable / scheduled : 0;

  const shared = {
    scheduleId: schedule.id,
    scheduleType: schedule.scheduleType,
    dayType,
    scheduledMinutes: scheduled,
    payableMinutes: payable,
    holidayName: payrollHoliday?.name ?? null,
  };

  if (schedule.scheduleType === ScheduleKind.OVERTIME) {
    const rate = overtimePayRate(rates, dayType, payrollHoliday);
    return {
      ...shared,
      rate,
      amount:
        (payable / MINUTES_PER_HOUR) *
        hourlyRateOf(rates, scheduled, settings) *
        rate,
    };
  }

  const rate = basePayRate(rates, dayType, payrollHoliday);
  let base = 0;
  if (rates.payType === PayType.PAY_BY_SHIFT) {
    base = rates.amountPerShift * workedRatio;
  } else if (rates.payType === PayType.STANDARD_WORKING_DAY) {
    base = rates.standardWorkingDaySalary * workedRatio;
  }
  return { ...shared, rate, amount: base * rate };
}

/** What an hour of overtime is worth, derived from whichever pay scheme applies. */
function hourlyRateOf(
  rates: PaysheetRates,
  shiftMinutes: number,
  settings: PayrollSettings,
): number {
  if (rates.payType === PayType.FIXED) {
    return (
      rates.salaryPerPeriod /
      settings.standardWorkingDays /
      settings.standardWorkingHoursPerDay
    );
  }
  if (rates.payType === PayType.STANDARD_WORKING_DAY) {
    return rates.standardWorkingDaySalary / settings.standardWorkingHoursPerDay;
  }
  // PAY_BY_SHIFT: the shift's own rate spread across its own length.
  return shiftMinutes
    ? rates.amountPerShift / (shiftMinutes / MINUTES_PER_HOUR)
    : 0;
}

export function payForSchedules(
  schedules: PayableSchedule[],
  rates: PaysheetRates,
  holidayByDate: Map<string, PayrollHoliday>,
  settings: PayrollSettings,
): { basePay: number; overtimePay: number; lines: PayLine[] } {
  const lines = schedules.map((schedule) =>
    schedulePay(
      schedule,
      rates,
      holidayByDate.get(dateKeyOf(schedule.workDate)) ?? null,
      settings,
    ),
  );

  return {
    basePay: lines
      .filter((line) => line.scheduleType !== ScheduleKind.OVERTIME)
      .reduce((total, line) => total + line.amount, 0),
    overtimePay: lines
      .filter((line) => line.scheduleType === ScheduleKind.OVERTIME)
      .reduce((total, line) => total + line.amount, 0),
    lines,
  };
}

// ─── Leave ───────────────────────────────────────────────────────────────────

export interface LeaveAllocation {
  dateKey: string;
  leaveType: 'PAID' | 'UNPAID';
  dayFraction: number;
}

/**
 * Spreads a request's approved paid/unpaid day totals across the days it covers.
 *
 * A manager approves *totals* ("2 paid, 1 unpaid"), not a per-day breakdown, so payroll has
 * to decide which days those are. **Paid days are allocated first, from the earliest
 * rostered day onwards**, and a single day may be split part paid, part unpaid.
 *
 * Only days the employee was **rostered to work** consume leave — a leave request spanning
 * a weekend they weren't working doesn't spend the allowance on it.
 *
 * `schedules` covers the *whole* request, not just this period. That is what makes a
 * request straddling two periods spend its paid days once, from the start of the request,
 * instead of restarting the allocation in each period.
 */
export function allocateLeaveDays(
  request: {
    startDate: Date;
    endDate: Date;
    paidLeaveDays: number;
    unpaidLeaveDays: number;
  },
  rosteredDateKeys: Set<string>,
  window: { fromKey: string; toKey: string },
): LeaveAllocation[] {
  const workDates: string[] = [];
  for (
    let day = new Date(`${dateKeyOf(request.startDate)}T00:00:00.000Z`);
    day <= new Date(`${dateKeyOf(request.endDate)}T00:00:00.000Z`);
    day.setUTCDate(day.getUTCDate() + 1)
  ) {
    const key = dateKeyOf(day);
    if (rosteredDateKeys.has(key)) workDates.push(key);
  }

  let paidLeft = request.paidLeaveDays;
  let unpaidLeft = request.unpaidLeaveDays;
  const allocations: LeaveAllocation[] = [];

  for (const dateKey of workDates) {
    let dayLeft = 1;

    if (paidLeft > 0) {
      const fraction = Math.min(dayLeft, paidLeft);
      paidLeft -= fraction;
      dayLeft -= fraction;
      if (dateKey >= window.fromKey && dateKey <= window.toKey) {
        allocations.push({ dateKey, leaveType: 'PAID', dayFraction: fraction });
      }
    }
    if (dayLeft > 0 && unpaidLeft > 0) {
      const fraction = Math.min(dayLeft, unpaidLeft);
      unpaidLeft -= fraction;
      if (dateKey >= window.fromKey && dateKey <= window.toKey) {
        allocations.push({
          dateKey,
          leaveType: 'UNPAID',
          dayFraction: fraction,
        });
      }
    }
    if (paidLeft <= 0 && unpaidLeft <= 0) break;
  }

  return allocations;
}

/**
 * What one paid leave day is worth.
 *
 * `PAY_BY_SHIFT` pays the shifts that were rostered on that day — several shifts means
 * several times the amount, and overtime shifts are excluded because a day off doesn't
 * earn the overtime somebody would have chosen to work.
 */
export function paidLeaveDayAmount(
  rates: PaysheetRates,
  settings: PayrollSettings,
  shiftsThatDay: number,
): number {
  if (rates.payType === PayType.FIXED) {
    return rates.salaryPerPeriod / settings.standardWorkingDays;
  }
  if (rates.payType === PayType.STANDARD_WORKING_DAY) {
    return rates.standardWorkingDaySalary;
  }
  return shiftsThatDay * rates.amountPerShift;
}

/**
 * What one unpaid leave day costs.
 *
 * **Only `FIXED` has anything to deduct.** The other two schemes pay for shifts worked, so
 * a day not worked simply earns nothing — subtracting again would charge for it twice.
 */
export function unpaidLeaveDayDeduction(
  rates: PaysheetRates,
  settings: PayrollSettings,
): number {
  return rates.payType === PayType.FIXED
    ? rates.salaryPerPeriod / settings.standardWorkingDays
    : 0;
}

// ─── Deductions ──────────────────────────────────────────────────────────────

/**
 * Whether a configured deduction is one this engine can price.
 *
 * Only fixed amounts, and only the three shapes below. Anything else — a percentage rule,
 * the old `BY_SALARY_COEFFICIENT` — is skipped and reported as
 * `UNSUPPORTED_DEDUCTION_RULE` rather than guessed at: a wrong deduction is money taken off
 * somebody's pay for a rule nobody wrote down.
 */
export function isSupportedDeduction(rule: {
  deductionType: string;
  conditionType: string | null;
}): boolean {
  return (
    rule.deductionType === 'FIXED' ||
    rule.conditionType === 'BY_OCCURRENCE' ||
    rule.conditionType === 'BY_BLOCK'
  );
}

/**
 * How many units of a deduction a set of violations earns.
 *
 * `BY_BLOCK` rounds **each violation up separately** — 16 minutes against a 15-minute block
 * is 2 blocks, and two separate 16-minute violations are 4, not 3. Rounding the total
 * instead would let repeated small violations escape.
 */
export function deductionUnits(
  rule: {
    deductionType: string;
    conditionType: string | null;
    blockMinutes: number | null;
  },
  violationMinutes: number[],
): number {
  if (rule.deductionType === 'FIXED') return 1;
  if (rule.conditionType === 'BY_BLOCK' && rule.blockMinutes) {
    return violationMinutes.reduce(
      (total, minutes) => total + Math.ceil(minutes / rule.blockMinutes!),
      0,
    );
  }
  return violationMinutes.length;
}

// ─── Fixed-salary proration ──────────────────────────────────────────────────

/**
 * A `FIXED` employee's earned salary for the days they actually worked.
 *
 * Each day is worth its worked minutes over the standard day, **capped at one day** — two
 * shifts on one day cannot earn two days of a monthly salary. Paid leave is added on top,
 * by the caller, as days that count without being worked.
 */
export function fixedWorkedPay(
  schedules: PayableSchedule[],
  rates: PaysheetRates,
  settings: PayrollSettings,
): number {
  const standardMinutes = settings.standardWorkingHoursPerDay * 60;

  const byDate = new Map<string, number>();
  for (const schedule of schedules) {
    if (schedule.scheduleType === ScheduleKind.OVERTIME) continue;
    const key = dateKeyOf(schedule.workDate);
    byDate.set(key, (byDate.get(key) ?? 0) + schedule.payableMinutes);
  }

  const dayUnits = [...byDate.values()].reduce(
    (total, minutes) => total + Math.min(1, minutes / standardMinutes),
    0,
  );
  return dayUnits * (rates.salaryPerPeriod / settings.standardWorkingDays);
}

/** Distinct days worked. Overtime shifts don't add a day — they are paid separately. */
export function workedDayCount(schedules: PayableSchedule[]): number {
  return new Set(
    schedules
      .filter((schedule) => schedule.scheduleType !== ScheduleKind.OVERTIME)
      .map((schedule) => dateKeyOf(schedule.workDate)),
  ).size;
}
