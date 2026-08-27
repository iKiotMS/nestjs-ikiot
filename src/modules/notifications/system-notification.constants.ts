/**
 * What the platform operators' own inbox is made of.
 *
 * A row is a system notification when **`tenantId` and `recipientId` are both null** — that
 * pair is the definition, and `notifySystem()` is the only thing that writes it. The type
 * whitelist below is a second, narrower gate on top: it keeps the operator console showing
 * the events it was built for, so adding a new `notifySystem` type never silently changes
 * what an operator sees until it is listed here on purpose.
 *
 * Ported from the `$in` arrays that iKiotMS-BE's `SystemNotificationController` repeated
 * inline in four separate handlers — and got wrong in the fifth (`markAsRead` had no filter
 * at all, so any notification in the system could be read back through it).
 */
export const SystemNotificationType = {
  TRANSACTION: 'SYSTEM_TRANSACTION',
  TENANT_CREATED: 'SYSTEM_TENANT_CREATED',
  TICKET_CREATED: 'SYSTEM_TICKET_CREATED',
  TENANT_BANK_UPDATED: 'SYSTEM_TENANT_BANK_UPDATED',
} as const;

export const SYSTEM_NOTIFICATION_TYPES: string[] = Object.values(
  SystemNotificationType,
);

/**
 * Announcements are not system events and never appear in that feed: an operator *wrote*
 * this one, and the row exists to record that it was sent. It is stored in the same table
 * with the same null pair, separated only by its type.
 */
export const ANNOUNCEMENT_TYPE = 'ANNOUNCEMENT';

/** Who an announcement goes to. `SELECTION` is the only one that reads `targetTenants`. */
export const AnnouncementTarget = {
  ALL: 'ALL',
  SELECTION: 'SELECTION',
} as const;

export const ANNOUNCEMENT_TARGETS: string[] = Object.values(AnnouncementTarget);

/**
 * The four categories the admin UI offers. Documentation, **not** a validation whitelist —
 * the old model took free text and the console is the only client, so closing the set here
 * would break it silently the day someone adds a fifth chip. Worth knowing that the value
 * is printed straight into the email subject line seen by every shop owner.
 */
export const KNOWN_ANNOUNCEMENT_CATEGORIES = [
  'Maintenance',
  'New feature',
  'Promotion',
  'Security',
];
