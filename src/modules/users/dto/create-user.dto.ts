import { IsOptional, IsString, IsUUID } from 'class-validator';
import { NormalizeEmail } from '../../../common/decorators/normalize-email.decorator';

/**
 * Puts a person on the books. **No password here** — hiring someone and giving them a login
 * are two separate acts, so they are two separate calls: this one creates them INACTIVE,
 * then `POST /users/:id/account` sets a password and switches the login on.
 *
 * Ported back to the old `StaffDTO`'s shape after the first NestJS pass collapsed the two
 * into one. The split matters in practice: HR enters new hires days before IT provisions
 * access, an employee can hold a paysheet, a shift and a leave balance before they ever log
 * in, and `deactivateAccount` clears the password to park someone in exactly this state
 * again — with the steps merged there was no way back out of it.
 */
export class CreateUserDto {
  /**
   * Shape is checked in the service by `validateVietnamPhoneNumber` — it is the login
   * handle and the OTP destination, so it has to be a number that can actually receive an
   * SMS, which a length rule can't express.
   */
  @IsString()
  phoneNumber: string;

  @IsOptional()
  @NormalizeEmail()
  email?: string;

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
