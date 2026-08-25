import {
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';

// Creates a STAFF account directly with a password (immediately ACTIVE) — the old
// system's separate INACTIVE→"create account"→ACTIVE step is deferred; note this if you
// need an invite-style onboarding flow later.
export class CreateUserDto {
  /**
   * Shape is checked in the service by `validateVietnamPhoneNumber` — it is the login
   * handle and the OTP destination, so it has to be a number that can actually receive an
   * SMS, which a length rule can't express.
   */
  @IsString()
  phoneNumber: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsString()
  @MinLength(6)
  password: string;

  @IsUUID()
  roleId: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;
}
