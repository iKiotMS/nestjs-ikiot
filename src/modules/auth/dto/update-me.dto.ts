import { IsDateString, IsIn, IsOptional, IsString } from 'class-validator';
import { NormalizeEmail } from '../../../common/decorators/normalize-email.decorator';

// Field-level write access is enforced in AuthService.updateMe, not here: TENANT_OWNER/ADMIN
// may set every field below; STAFF/CUSTOMER may only set avatarUrl (mirrors the old
// AuthService.updateProfile role gate).
export class UpdateMeDto {
  @IsOptional()
  @NormalizeEmail()
  email?: string;

  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsString()
  avatarUrl?: string;

  @IsOptional()
  @IsDateString()
  dob?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  taxNumber?: string;

  @IsOptional()
  @IsString()
  identificationId?: string;

  @IsOptional()
  @IsIn(['MALE', 'FEMALE', 'OTHER'])
  gender?: string;
}
