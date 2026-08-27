/** Vietnam is UTC+7 year-round — see `working-schedules/schedule-time.ts`. */
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

export const PayrollPeriodStatus = {
  DRAFT: 'DRAFT',
  REVIEW: 'REVIEW',
  APPROVED: 'APPROVED',
  PAID: 'PAID',
  CANCELLED: 'CANCELLED',
} as const;

export const PAYROLL_PERIOD_STATUSES = Object.values(PayrollPeriodStatus);

/** The actions that move a period, and where each one may run from. */
export const PAYROLL_TRANSITIONS = {
  SUBMIT: { from: PayrollPeriodStatus.DRAFT, to: PayrollPeriodStatus.REVIEW },
  CANCEL: {
    from: PayrollPeriodStatus.DRAFT,
    to: PayrollPeriodStatus.CANCELLED,
  },
  RETURN_TO_DRAFT: {
    from: PayrollPeriodStatus.REVIEW,
    to: PayrollPeriodStatus.DRAFT,
  },
  APPROVE: {
    from: PayrollPeriodStatus.REVIEW,
    to: PayrollPeriodStatus.APPROVED,
  },
  MARK_PAID: {
    from: PayrollPeriodStatus.APPROVED,
    to: PayrollPeriodStatus.PAID,
  },
} as const;

export type PayrollAction = keyof typeof PAYROLL_TRANSITIONS;

/**
 * The payslip statuses an employee may see.
 *
 * DRAFT and CANCELLED are absent on purpose: a draft is the manager's working copy and
 * showing it would have people querying numbers that are still being edited. REVIEW *is*
 * visible — that window exists so employees can check their provisional figures and object
 * before APPROVED fixes them.
 */
export const EMPLOYEE_VISIBLE_PAYSLIP_STATUSES = [
  PayrollPeriodStatus.REVIEW,
  PayrollPeriodStatus.APPROVED,
  PayrollPeriodStatus.PAID,
];

/**
 * A payroll period covers a whole calendar month.
 *
 * `PayrollSetting.periodStartDay` exists but is not honoured — see the note in
 * `payroll-setting.dto.ts`. iKiotMS-BE accepted the parameter here and ignored it too, and
 * both its DTOs refused to let anyone set it.
 *
 * Dates are plain UTC midnights, matching the `@db.Date` columns every other date in the
 * HR modules uses. The old code stored Vietnam-midnight *instants* because Mongo had no
 * date type, which is why it carried a `buildPeriodDate` offset dance and a warning never
 * to `.toISOString().slice(0,10)` a stored value. With a real `date` column that whole
 * class of off-by-one goes away.
 */
export function monthlyPeriodRange(payrollMonth: string): {
  periodStart: Date;
  periodEnd: Date;
  startKey: string;
  endKey: string;
  year: number;
  month: number;
} {
  const [year, month] = payrollMonth.split('-').map(Number);
  const periodStart = new Date(Date.UTC(year, month - 1, 1));
  // Day 0 of the next month is the last day of this one.
  const periodEnd = new Date(Date.UTC(year, month, 0));

  return {
    periodStart,
    periodEnd,
    startKey: periodStart.toISOString().slice(0, 10),
    endKey: periodEnd.toISOString().slice(0, 10),
    year,
    month,
  };
}

/** Today's date in the shop's timezone — what "has the period ended" is judged against. */
export function vietnamToday(now = new Date()): string {
  return new Date(now.getTime() + VN_OFFSET_MS).toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` for a stored `@db.Date`. */
export function dateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}
