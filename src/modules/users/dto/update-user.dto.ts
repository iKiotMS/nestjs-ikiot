import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { NormalizeEmail } from '../../../common/decorators/normalize-email.decorator';

/** The personal details on a staff record. Flattened to `profile_*` columns in Postgres. */
export class StaffProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;

  @IsOptional()
  @IsString()
  avatarUrl?: string;

  @IsOptional()
  @IsDateString()
  dob?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  taxNumber?: string;

  /**
   * Vietnamese citizen ID. Shape *and* consistency with `dob`/`gender` are checked in the
   * service — see `validateVietnamIdentificationId` for why the three have to agree.
   */
  @IsOptional()
  @IsString()
  identificationId?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsIn(['MALE', 'FEMALE', 'OTHER'])
  gender?: string;
}

/**
 * Ported from iKiotMS-BE's `updateStaffDTO` + the checks `updateStaff` ran around it.
 *
 * Three fields the old endpoint refused, and this one still refuses:
 *  - `password` — self-service via `/auth`, or a manager reset via
 *    `PATCH /users/:id/account/password`.
 *  - `phoneNumber` — it is the login handle; changing it is not an edit.
 *  - `status` — the account lifecycle has its own routes
 *    (`POST /users/:id/account`, `PATCH /users/:id/account/deactivate`) and they run
 *    guards that a plain field write would skip. Accepting it here was a hole introduced
 *    by the first NestJS pass, not something the old system allowed.
 *
 * `systemRole` is absent for the same reason it always was: a STAFF account can never be
 * promoted to TENANT_OWNER/ADMIN through this endpoint.
 */
export class UpdateUserDto {
  @IsOptional()
  @NormalizeEmail()
  email?: string;

  /** The tenant-defined Role this account holds. */
  @IsOptional()
  @IsUUID()
  roleId?: string;

  /**
   * Where this person works. Setting one clears the other — a staff member is posted at
   * exactly one location, and the service enforces that rather than trusting the client to
   * send both halves.
   */
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @IsOptional()
  @IsDateString()
  hireDate?: string;

  /** Which pay scheme this person is on. Must be an ACTIVE paysheet in the tenant. */
  @IsOptional()
  @IsUUID()
  paysheetId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  accountNote?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => StaffProfileDto)
  profile?: StaffProfileDto;
}
