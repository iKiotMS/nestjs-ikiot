/**
 * A Vietnamese phone number in E.164 (`+84…`), so `0912345678`, `84912345678` and
 * `+84 912 345 678` all resolve to the same string.
 *
 * Ported from iKiotMS-BE's `src/utils/phone.js`. It is used for **keying**, not for
 * storage: `User.phoneNumber` keeps whatever the user typed (it is the login handle and
 * changing its shape would lock people out), but the OTP store keys on this, so a code
 * requested as `0912345678` still verifies when the confirm step sends `+84912345678`.
 * The first NestJS pass keyed OTPs on the raw string and lost that.
 */
export function normalizePhone(phone: string | null | undefined): string {
  if (!phone) return '';
  const cleaned = String(phone)
    .trim()
    .replace(/[\s\-().]/g, '');
  if (cleaned.startsWith('+')) return cleaned;
  if (cleaned.startsWith('84')) return `+${cleaned}`;
  if (cleaned.startsWith('0')) return `+84${cleaned.slice(1)}`;
  return `+${cleaned}`;
}
