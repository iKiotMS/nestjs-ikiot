export const CashDrawerStatus = {
  OPEN: 'OPEN',
  CLOSED: 'CLOSED',
} as const;

export type CashDrawerStatus =
  (typeof CashDrawerStatus)[keyof typeof CashDrawerStatus];

export const CASH_DRAWER_STATUSES: readonly string[] =
  Object.values(CashDrawerStatus);

/**
 * A shift log is written when a cashier takes the drawer (`START`) and when they hand it
 * back (`END`). An `END` naming a `nextStaffId` is a handover: the drawer passes straight
 * to that person and stays open. An `END` naming nobody is the last shift of the day, and
 * is what makes the session finalizable.
 */
export const ShiftLogType = {
  START: 'START',
  END: 'END',
} as const;

export type ShiftLogType = (typeof ShiftLogType)[keyof typeof ShiftLogType];

export const SHIFT_LOG_TYPES: readonly string[] = Object.values(ShiftLogType);

/**
 * Which day a drawer belongs to is a question about the shop's local calendar, not UTC.
 * A drawer opened at 00:30 in Ho Chi Minh City belongs to that day, even though UTC still
 * calls it yesterday evening. Ported from the hardcoded zone in iKiotMS-BE's
 * `CashDrawerService.businessDate`.
 */
export const BUSINESS_TIMEZONE = 'Asia/Ho_Chi_Minh';
