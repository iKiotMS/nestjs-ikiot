import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @IsString()
  @MinLength(2)
  tenantName: string;

  @IsString()
  @MinLength(8)
  phoneNumber: string;

  @IsString()
  @MinLength(6)
  password: string;

  // Verified against OtpService before the tenant/owner are created — see
  // AuthService.register. In dev without ESMS_API_KEY/ESMS_SECRET_KEY configured, the
  // code is logged to the server console instead of being sent as a real SMS.
  @IsString()
  otpCode: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;
}
