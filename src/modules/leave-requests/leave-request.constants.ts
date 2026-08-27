export const LeaveRequestStatus = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED',
  DELETED: 'DELETED',
} as const;

export const LEAVE_REQUEST_STATUSES = Object.values(LeaveRequestStatus);

/**
 * Statuses that still hold a claim on the calendar and on the leave balance — the pair
 * that blocks an overlapping request, and the only pair a cancellation can act on.
 */
export const LIVE_LEAVE_STATUSES = [
  LeaveRequestStatus.PENDING,
  LeaveRequestStatus.APPROVED,
];

/** What a reviewer may decide. */
export const REVIEW_DECISIONS = [
  LeaveRequestStatus.APPROVED,
  LeaveRequestStatus.REJECTED,
];

/**
 * The annual allowance assumed for an employee whose balance was never set.
 *
 * 12 days is Vietnam's statutory minimum and the number the old service defaulted to in
 * three separate places. `UserService` writes the real figure through
 * `POST|PATCH /users/:id/leave-balance`.
 */
export const DEFAULT_ANNUAL_LEAVE_DAYS = 12;
