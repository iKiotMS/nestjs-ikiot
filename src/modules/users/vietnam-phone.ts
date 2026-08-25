import { BadRequestException } from '@nestjs/common';

/**
 * Mobile prefixes actually issued in Vietnam, after the 2018 renumbering:
 * Viettel 03x, Vietnamobile 05x, Mobifone 07x, Vinaphone 08x, and the legacy 09x block.
 */
const VIETNAM_MOBILE_PHONE_REGEX =
  /^(?:03[2-9]|05[25689]|07[06789]|08[1-9]|09\d)\d{7}$/;

/**
 * Ranges that look like a mobile number but can never be one. Each gets its own message
 * because "invalid phone number" is useless when the number is a real, working line —
 * whoever typed it needs to be told *why* it can't be a staff number.
 */
const RESERVED_RANGES: readonly { pattern: RegExp; reason: string }[] = [
  {
    pattern: /^065\d{7}$/,
    reason:
      'Đầu số 065 dành cho dịch vụ điện thoại Internet (VoIP), không được dùng làm số di động của nhân viên',
  },
  {
    pattern: /^067\d{7}$/,
    reason:
      'Đầu số 067 dành cho dịch vụ điện thoại vệ tinh (VSAT), không được dùng làm số di động của nhân viên',
  },
  {
    pattern: /^069[2-9]\d{6}$/,
    reason:
      'Đầu số 069 dành cho mạng dùng riêng của cơ quan Đảng, Nhà nước, Công an và Quân đội, không được dùng làm số di động của nhân viên',
  },
  {
    pattern: /^080\d{7}$/,
    reason:
      'Đầu số 080 dành cho dịch vụ của Cục Bưu điện Trung ương, không được dùng làm số di động của nhân viên',
  },
  {
    pattern: /^111$/,
    reason:
      'Số 111 là Tổng đài quốc gia bảo vệ trẻ em, không được dùng làm số di động của nhân viên',
  },
  {
    pattern: /^112$/,
    reason:
      'Số 112 là tổng đài ứng cứu khẩn cấp, tìm kiếm cứu nạn, không được dùng làm số di động của nhân viên',
  },
  {
    pattern: /^113$/,
    reason:
      'Số 113 là số điện thoại khẩn cấp của Công an, không được dùng làm số di động của nhân viên',
  },
  {
    pattern: /^114$/,
    reason:
      'Số 114 là số điện thoại khẩn cấp về cứu hỏa, cứu nạn cứu hộ, không được dùng làm số di động của nhân viên',
  },
  {
    pattern: /^115$/,
    reason:
      'Số 115 là số điện thoại cấp cứu y tế, không được dùng làm số di động của nhân viên',
  },
];

/**
 * Validates a Vietnamese mobile number for a staff account.
 *
 * This matters more than a length check because the phone number **is the login handle**
 * (see AuthService) and it is what OTP is sent to. A number that can't receive an SMS is an
 * account nobody can ever get into, discovered at the worst possible moment.
 *
 * A pure function, deliberately — same reason as `validateVietnamIdentificationId`. Ported
 * from iKiotMS-BE's `validateStaffPhoneNumber`.
 *
 * @returns the trimmed number
 */
export function validateVietnamPhoneNumber(phoneNumber: string): string {
  const value = phoneNumber.trim();

  if (!value) {
    throw new BadRequestException('Số điện thoại là bắt buộc');
  }

  // Checked before the shape rules on purpose: an emergency line is three digits, so the
  // "must be 10 digits" message would fire first and explain nothing.
  const reserved = RESERVED_RANGES.find(({ pattern }) => pattern.test(value));
  if (reserved) throw new BadRequestException(reserved.reason);

  if (!/^\d{10}$/.test(value)) {
    throw new BadRequestException('Số điện thoại phải gồm đúng 10 chữ số');
  }
  if (!VIETNAM_MOBILE_PHONE_REGEX.test(value)) {
    throw new BadRequestException(
      'Đầu số điện thoại di động Việt Nam không hợp lệ',
    );
  }

  return value;
}
