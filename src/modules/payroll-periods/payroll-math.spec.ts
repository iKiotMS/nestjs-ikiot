import {
  allocateLeaveDays,
  basePayRate,
  dayTypeOf,
  deductionUnits,
  fixedWorkedPay,
  isSupportedDeduction,
  overtimePayRate,
  paidLeaveDayAmount,
  payableMinutesOf,
  scheduleEarlyLeaveMinutes,
  scheduleLateInfo,
  schedulePay,
  toPayableSchedules,
  unpaidLeaveDayDeduction,
  workedDayCount,
} from './payroll-math';
import type {
  AttendanceSpan,
  PayableSchedule,
  PayrollSettings,
  PaysheetRates,
  SchedulePeriod,
} from './payroll-math';

const settings: PayrollSettings = {
  standardWorkingDays: 26,
  standardWorkingHoursPerDay: 8,
  weekendDays: [0],
  lateGraceMinutes: 15,
};

const rates = (over: Partial<PaysheetRates> = {}): PaysheetRates => ({
  payType: 'PAY_BY_SHIFT',
  amountPerShift: 400_000,
  salaryPerPeriod: 13_000_000,
  standardWorkingDaySalary: 500_000,
  baseWeekend: 2,
  basePublicHoliday: 3,
  overtimeNormalDay: 1.5,
  overtimeWeekend: 2,
  overtimePublicHoliday: 3,
  ...over,
});

/** A Monday 08:00–17:00 shift (Vietnam), i.e. 01:00–10:00 UTC. */
const shift = (over: Partial<SchedulePeriod> = {}): SchedulePeriod => ({
  id: 'sched-1',
  scheduleType: 'NORMAL',
  workDate: '2026-09-07',
  startAt: new Date('2026-09-07T01:00:00.000Z'),
  endAt: new Date('2026-09-07T10:00:00.000Z'),
  ...over,
});

const attendance = (over: Partial<AttendanceSpan> = {}): AttendanceSpan => ({
  scheduleId: 'sched-1',
  actualCheckinAt: new Date('2026-09-07T01:00:00.000Z'),
  actualCheckoutAt: new Date('2026-09-07T10:00:00.000Z'),
  lateMinutes: 0,
  ...over,
});

const payable = (over: Partial<PayableSchedule> = {}): PayableSchedule => ({
  ...shift(),
  actualWorkedMinutes: 540,
  payableMinutes: 540,
  ...over,
});

const HOLIDAY = { name: 'Quốc khánh', type: 'PUBLIC_HOLIDAY' };
const COMPANY = { name: 'Nghỉ công ty', type: 'COMPANY_HOLIDAY' };

describe('day classification and rates', () => {
  it('reads a Sunday as the weekend', () => {
    expect(dayTypeOf('2026-09-06', null, [0])).toBe('WEEKEND');
    expect(dayTypeOf('2026-09-07', null, [0])).toBe('NORMAL');
  });

  // A shop's own closure carries no statutory multiplier; paying one would invent money.
  it('ignores a COMPANY_HOLIDAY entirely', () => {
    expect(dayTypeOf('2026-09-07', COMPANY, [0])).toBe('NORMAL');
    expect(basePayRate(rates(), 'NORMAL', COMPANY)).toBe(1);
  });

  it('lets a public holiday outrank a weekend rather than stacking', () => {
    expect(dayTypeOf('2026-09-06', HOLIDAY, [0])).toBe('WEEKEND_HOLIDAY');
    // 3, not 2 and not 6.
    expect(basePayRate(rates(), 'WEEKEND_HOLIDAY', HOLIDAY)).toBe(3);
    expect(overtimePayRate(rates(), 'WEEKEND_HOLIDAY', HOLIDAY)).toBe(3);
  });

  it('pays a normal day at 1× base and 1.5× overtime', () => {
    expect(basePayRate(rates(), 'NORMAL', null)).toBe(1);
    expect(overtimePayRate(rates(), 'NORMAL', null)).toBe(1.5);
  });
});

describe('payableMinutesOf', () => {
  it('clips the clock to the shift at both ends', () => {
    const early = attendance({
      actualCheckinAt: new Date('2026-09-07T00:30:00.000Z'),
      actualCheckoutAt: new Date('2026-09-07T11:00:00.000Z'),
    });
    // 09:00 of shift, not 10:30 of presence.
    expect(payableMinutesOf(shift(), [early])).toBe(540);
  });

  // Two overlapping attendance rows on one shift must not both be paid.
  it('merges overlapping attendance rather than adding it up', () => {
    const first = attendance({
      actualCheckoutAt: new Date('2026-09-07T06:00:00.000Z'),
    });
    const second = attendance({
      actualCheckinAt: new Date('2026-09-07T05:00:00.000Z'),
      actualCheckoutAt: new Date('2026-09-07T08:00:00.000Z'),
    });
    // 01:00–08:00 = 420, not 300 + 180.
    expect(payableMinutesOf(shift(), [first, second])).toBe(420);
  });

  it('pays nothing for a shift clocked into but never out of', () => {
    expect(
      payableMinutesOf(shift(), [attendance({ actualCheckoutAt: null })]),
    ).toBe(0);
  });
});

describe('scheduleLateInfo', () => {
  it('prefers the stored lateMinutes over deriving one', () => {
    const late = attendance({
      actualCheckinAt: new Date('2026-09-07T01:40:00.000Z'),
      lateMinutes: 40,
    });
    expect(scheduleLateInfo(shift(), [late], 15)).toEqual({
      rawMinutes: 40,
      violationMinutes: 40,
    });
  });

  // Grace is all-or-nothing: past it, the whole lateness counts, not the excess.
  it('derives all-or-nothing grace when nothing was stored', () => {
    const within = attendance({
      actualCheckinAt: new Date('2026-09-07T01:10:00.000Z'),
      lateMinutes: null,
    });
    expect(scheduleLateInfo(shift(), [within], 15).violationMinutes).toBe(0);

    const past = attendance({
      actualCheckinAt: new Date('2026-09-07T01:20:00.000Z'),
      lateMinutes: null,
    });
    expect(scheduleLateInfo(shift(), [past], 15).violationMinutes).toBe(20);
  });

  it('never counts an overtime shift as late', () => {
    const otShift = shift({ scheduleType: 'OVERTIME' });
    const late = attendance({
      actualCheckinAt: new Date('2026-09-07T03:00:00.000Z'),
      lateMinutes: 120,
    });
    expect(scheduleLateInfo(otShift, [late], 15).violationMinutes).toBe(0);
  });
});

describe('scheduleEarlyLeaveMinutes', () => {
  it('uses the latest checkout, not the first', () => {
    const out = attendance({
      actualCheckoutAt: new Date('2026-09-07T08:00:00.000Z'),
    });
    const backAgain = attendance({
      actualCheckoutAt: new Date('2026-09-07T09:30:00.000Z'),
    });
    // 30 minutes short, not 120 + 30.
    expect(scheduleEarlyLeaveMinutes(shift(), [out, backAgain])).toBe(30);
  });
});

/**
 * The restoration rules exist so nobody is punished twice: when a penalty rule takes the
 * money, the time it cost is given back.
 */
describe('toPayableSchedules', () => {
  const late = attendance({
    actualCheckinAt: new Date('2026-09-07T01:40:00.000Z'),
    lateMinutes: 40,
  });

  it('restores the whole shortfall when a late penalty will charge for it', () => {
    const [result] = toPayableSchedules([shift()], [late], {
      hasLatePenalty: true,
      hasEarlyLeavePenalty: false,
      graceMinutes: 15,
    });
    expect(result.actualWorkedMinutes).toBe(500);
    expect(result.payableMinutes).toBe(540);
  });

  it('restores only the grace when no penalty rule is configured', () => {
    const [result] = toPayableSchedules([shift()], [late], {
      hasLatePenalty: false,
      hasEarlyLeavePenalty: false,
      graceMinutes: 15,
    });
    // 500 worked + 0 restored (raw 40 − violation 40) — the lateness still costs time.
    expect(result.payableMinutes).toBe(500);
  });

  it('never pays for more than the shift is long', () => {
    const over = attendance({
      actualCheckinAt: new Date('2026-09-07T00:00:00.000Z'),
      actualCheckoutAt: new Date('2026-09-07T12:00:00.000Z'),
    });
    const [result] = toPayableSchedules([shift()], [over], {
      hasLatePenalty: true,
      hasEarlyLeavePenalty: true,
      graceMinutes: 15,
    });
    expect(result.payableMinutes).toBe(540);
  });

  it('drops shifts nobody turned up to', () => {
    expect(
      toPayableSchedules([shift()], [], {
        hasLatePenalty: false,
        hasEarlyLeavePenalty: false,
        graceMinutes: 15,
      }),
    ).toHaveLength(0);
  });
});

describe('schedulePay', () => {
  it('pays a PAY_BY_SHIFT shift pro rata', () => {
    const line = schedulePay(
      payable({ payableMinutes: 270 }),
      rates(),
      null,
      settings,
    );
    expect(line.amount).toBe(200_000); // half a 400k shift
  });

  it('multiplies by the holiday rate', () => {
    const line = schedulePay(payable(), rates(), HOLIDAY, settings);
    expect(line.rate).toBe(3);
    expect(line.amount).toBe(1_200_000);
  });

  // Their period salary is prorated across the whole period instead — doing it per shift
  // would make capping a day at one day's pay impossible.
  it('emits a zero-amount line for a FIXED employee normal shift', () => {
    const line = schedulePay(
      payable(),
      rates({ payType: 'FIXED' }),
      null,
      settings,
    );
    expect(line.amount).toBe(0);
    expect(line.payableMinutes).toBe(540);
  });

  it('prices overtime from the hourly equivalent', () => {
    const line = schedulePay(
      payable({ scheduleType: 'OVERTIME', payableMinutes: 120 }),
      rates({ payType: 'STANDARD_WORKING_DAY' }),
      null,
      settings,
    );
    // 500k/8h = 62.5k per hour × 2h × 1.5
    expect(line.amount).toBe(187_500);
  });
});

describe('fixedWorkedPay and workedDayCount', () => {
  const fixed = rates({ payType: 'FIXED' });

  it('caps a day at one day of salary however many shifts it holds', () => {
    const twoShifts = [
      payable({ id: 'a', payableMinutes: 480 }),
      payable({ id: 'b', payableMinutes: 480 }),
    ];
    expect(fixedWorkedPay(twoShifts, fixed, settings)).toBe(13_000_000 / 26);
  });

  it('prorates a part-worked day', () => {
    const half = [payable({ payableMinutes: 240 })];
    expect(fixedWorkedPay(half, fixed, settings)).toBeCloseTo(
      (13_000_000 / 26) * 0.5,
      6,
    );
  });

  it('counts one worked day per date and never counts overtime as a day', () => {
    expect(
      workedDayCount([
        payable({ id: 'a' }),
        payable({ id: 'b' }),
        payable({ id: 'c', scheduleType: 'OVERTIME' }),
        payable({ id: 'd', workDate: '2026-09-08' }),
      ]),
    ).toBe(2);
  });
});

describe('allocateLeaveDays', () => {
  const rostered = new Set(['2026-09-07', '2026-09-08', '2026-09-09']);
  const window = { fromKey: '2026-09-01', toKey: '2026-09-30' };

  it('spends paid days first, then unpaid', () => {
    const allocations = allocateLeaveDays(
      {
        startDate: new Date('2026-09-07'),
        endDate: new Date('2026-09-09'),
        paidLeaveDays: 2,
        unpaidLeaveDays: 1,
      },
      rostered,
      window,
    );
    expect(allocations).toEqual([
      { dateKey: '2026-09-07', leaveType: 'PAID', dayFraction: 1 },
      { dateKey: '2026-09-08', leaveType: 'PAID', dayFraction: 1 },
      { dateKey: '2026-09-09', leaveType: 'UNPAID', dayFraction: 1 },
    ]);
  });

  it('splits a single day between paid and unpaid', () => {
    const allocations = allocateLeaveDays(
      {
        startDate: new Date('2026-09-07'),
        endDate: new Date('2026-09-07'),
        paidLeaveDays: 0.5,
        unpaidLeaveDays: 0.5,
      },
      rostered,
      window,
    );
    expect(allocations).toEqual([
      { dateKey: '2026-09-07', leaveType: 'PAID', dayFraction: 0.5 },
      { dateKey: '2026-09-07', leaveType: 'UNPAID', dayFraction: 0.5 },
    ]);
  });

  // Leave over a day they weren't rostered doesn't spend the allowance on it.
  it('only consumes days the employee was rostered to work', () => {
    const allocations = allocateLeaveDays(
      {
        startDate: new Date('2026-09-05'),
        endDate: new Date('2026-09-09'),
        paidLeaveDays: 5,
        unpaidLeaveDays: 0,
      },
      rostered,
      window,
    );
    expect(allocations.map((a) => a.dateKey)).toEqual([
      '2026-09-07',
      '2026-09-08',
      '2026-09-09',
    ]);
  });

  // A request straddling two periods spends its paid days once, from the request's start.
  it('allocates from the start of the request but reports only this window', () => {
    const allocations = allocateLeaveDays(
      {
        startDate: new Date('2026-09-07'),
        endDate: new Date('2026-09-09'),
        paidLeaveDays: 3,
        unpaidLeaveDays: 0,
      },
      rostered,
      { fromKey: '2026-09-09', toKey: '2026-09-30' },
    );
    expect(allocations).toEqual([
      { dateKey: '2026-09-09', leaveType: 'PAID', dayFraction: 1 },
    ]);
  });
});

describe('leave day amounts', () => {
  it('pays a PAY_BY_SHIFT leave day per shift that was rostered', () => {
    expect(paidLeaveDayAmount(rates(), settings, 2)).toBe(800_000);
  });

  it('pays a FIXED leave day as one standard day of the period salary', () => {
    expect(paidLeaveDayAmount(rates({ payType: 'FIXED' }), settings, 1)).toBe(
      13_000_000 / 26,
    );
  });

  // Shift-based schemes pay for shifts worked; an unworked day already earns nothing, so
  // deducting again would charge for it twice.
  it('only deducts unpaid leave for FIXED', () => {
    expect(unpaidLeaveDayDeduction(rates(), settings)).toBe(0);
    expect(unpaidLeaveDayDeduction(rates({ payType: 'FIXED' }), settings)).toBe(
      13_000_000 / 26,
    );
  });
});

describe('deductions', () => {
  it('accepts the three shapes it can price and rejects the rest', () => {
    expect(
      isSupportedDeduction({ deductionType: 'FIXED', conditionType: null }),
    ).toBe(true);
    expect(
      isSupportedDeduction({
        deductionType: 'LATE',
        conditionType: 'BY_OCCURRENCE',
      }),
    ).toBe(true);
    expect(
      isSupportedDeduction({
        deductionType: 'LATE',
        conditionType: 'BY_SALARY_COEFFICIENT',
      }),
    ).toBe(false);
  });

  it('counts one unit per violation for BY_OCCURRENCE', () => {
    expect(
      deductionUnits(
        {
          deductionType: 'LATE',
          conditionType: 'BY_OCCURRENCE',
          blockMinutes: null,
        },
        [20, 45, 5],
      ),
    ).toBe(3);
  });

  // Rounding each violation separately is the point: rounding the total would let repeated
  // small violations escape.
  it('rounds each violation up separately for BY_BLOCK', () => {
    expect(
      deductionUnits(
        { deductionType: 'LATE', conditionType: 'BY_BLOCK', blockMinutes: 15 },
        [16, 16],
      ),
    ).toBe(4);
  });

  it('charges a FIXED deduction once', () => {
    expect(
      deductionUnits(
        { deductionType: 'FIXED', conditionType: null, blockMinutes: null },
        [],
      ),
    ).toBe(1);
  });
});
