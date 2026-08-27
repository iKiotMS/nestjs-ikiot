export const AttendanceStatus = {
  CHECKED_IN: 'CHECKED_IN',
  CHECKED_OUT: 'CHECKED_OUT',
  ABSENT: 'ABSENT',
} as const;

export const ATTENDANCE_STATUSES = Object.values(AttendanceStatus);

/** What a manager may write by hand. Same three the old DTO allowed. */
export const MANUAL_ATTENDANCE_STATUSES = ATTENDANCE_STATUSES;

/**
 * How early somebody may clock in before their shift starts.
 *
 * Ported from `PayrollConstants.ALLOWED_EARLY_CHECKIN_MINUTES`. It is a business rule, not
 * a tolerance: clocking in an hour early would otherwise start counting work time before
 * the shift, and `workedMinutes` feeds payroll.
 */
export const ALLOWED_EARLY_CHECKIN_MINUTES = 30;

/**
 * Payroll period statuses that freeze the attendance underneath them.
 *
 * Ported from `PayrollAttendancePolicy`: once a period is in REVIEW or beyond, the numbers
 * have been read by a human and possibly paid out, so the inputs stop moving. DRAFT is
 * still editable — that is the whole point of a draft.
 */
export const ATTENDANCE_LOCKING_PERIOD_STATUSES = [
  'REVIEW',
  'APPROVED',
  'PAID',
];

/** Every period status that can cover a work date at all. */
export const OPEN_PERIOD_STATUSES = [
  'DRAFT',
  ...ATTENDANCE_LOCKING_PERIOD_STATUSES,
];
