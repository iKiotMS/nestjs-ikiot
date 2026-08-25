import { BadRequestException } from '@nestjs/common';

/**
 * The three-digit province-of-birth prefixes a Vietnamese citizen ID may start with.
 * Ported verbatim from iKiotMS-BE's StaffIdentificationValidator.
 */
// prettier-ignore
export const VIETNAM_PROVINCE_CODES: ReadonlySet<string> = new Set([
  '001', '002', '004', '006', '008', '010', '011', '012', '014',
  '015', '017', '019', '020', '022', '024', '025', '026', '027',
  '030', '031', '033', '034', '035', '036', '037', '038', '040',
  '042', '044', '045', '046', '048', '049', '051', '052', '054',
  '056', '058', '060', '062', '064', '066', '067', '068', '070',
  '072', '074', '075', '077', '079', '080', '082', '083', '084',
  '086', '087', '089', '091', '092', '093', '094', '095', '096',
]);

/** Digit 4 encodes century *and* sex: even = male, odd = female, pair per century. */
function birthYearOf(centurySexCode: number, yearSuffix: string): number {
  return 1900 + Math.floor(centurySexCode / 2) * 100 + Number(yearSuffix);
}

/**
 * Validates a 12-digit Vietnamese citizen ID (CCCD) and cross-checks it against the
 * profile it is being attached to.
 *
 * The number is not opaque: digits 1–3 are the province of birth, digit 4 encodes the
 * century and the sex, and digits 5–6 are the last two of the birth year. So a CCCD that
 * disagrees with the `dob` or `gender` on the same profile means one of the two was typed
 * wrong — and finding that out at data-entry time is the whole point, because payroll and
 * social-insurance exports downstream trust all three.
 *
 * A pure function, deliberately: it is the kind of rule that deserves a test rather than a
 * trip through the database. Ported from iKiotMS-BE's `validateStaffIdentificationId`.
 *
 * @returns the trimmed, normalised number
 */
export function validateVietnamIdentificationId(
  identificationId: string,
  profile: { dob?: Date | string | null; gender?: string | null } = {},
): string {
  const value = identificationId.trim();

  if (!value) {
    throw new BadRequestException('Số căn cước là bắt buộc');
  }
  if (!/^\d+$/.test(value)) {
    throw new BadRequestException('Số căn cước chỉ được chứa chữ số');
  }
  if (value.length !== 12) {
    throw new BadRequestException('Số căn cước phải gồm đúng 12 chữ số');
  }
  if (!VIETNAM_PROVINCE_CODES.has(value.slice(0, 3))) {
    throw new BadRequestException(
      'Mã nơi đăng ký khai sinh trên số căn cước không hợp lệ',
    );
  }

  const centurySexCode = Number(value[3]);
  const birthYear = birthYearOf(centurySexCode, value.slice(4, 6));

  if (profile.dob !== undefined && profile.dob !== null && profile.dob !== '') {
    const dob = new Date(profile.dob);
    if (Number.isNaN(dob.getTime())) {
      throw new BadRequestException('Ngày sinh của nhân viên không hợp lệ');
    }
    if (dob.getUTCFullYear() !== birthYear) {
      throw new BadRequestException(
        'Năm sinh trên số căn cước không khớp với ngày sinh của nhân viên',
      );
    }
  }

  if (profile.gender === 'MALE' && centurySexCode % 2 !== 0) {
    throw new BadRequestException(
      'Giới tính trên số căn cước không khớp với giới tính của nhân viên',
    );
  }
  if (profile.gender === 'FEMALE' && centurySexCode % 2 !== 1) {
    throw new BadRequestException(
      'Giới tính trên số căn cước không khớp với giới tính của nhân viên',
    );
  }

  return value;
}
