/**
 * Lifecycle of a User account. iKiotMS-BE never declared these anywhere — every module
 * wrote the strings inline, which is how `'DELETED'` ended up spelled out at a dozen call
 * sites. Same idea as LocationStatus, for the other half of the schema.
 *
 * DELETED is a soft delete (`User.deletedAt` is set alongside it): orders, attendances,
 * audit logs and payslips all hold a foreign key to the user.
 */
export const UserStatus = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  SUSPENDED: 'SUSPENDED',
  DELETED: 'DELETED',
} as const;

export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

/**
 * Statuses that refuse a login and invalidate an already-issued token. Checked both in
 * AuthService (at login) and in JwtStrategy (on every subsequent request), which is the
 * point of having exactly one copy: suspending an account must lock out the session that
 * is already running, not just the next login.
 */
export const INACTIVE_USER_STATUSES: ReadonlySet<string> = new Set([
  UserStatus.SUSPENDED,
  UserStatus.INACTIVE,
  UserStatus.DELETED,
]);

/** What a client may set directly on a user — DELETED is reachable only via DELETE. */
export const SETTABLE_USER_STATUSES: readonly string[] = [
  UserStatus.ACTIVE,
  UserStatus.INACTIVE,
  UserStatus.SUSPENDED,
];
