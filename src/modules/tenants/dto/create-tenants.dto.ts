import { IsOptional, IsString } from 'class-validator';

/**
 * Reachable only through the `AdminOnlyGuard`-gated `/tenants` controller.
 *
 * `bankingSepayWebhookApiKey` is writable here on purpose — it replaces iKiotMS-BE's
 * SUPER_ADMIN-only `PUT /tenant/:tenantId/sepay-key`, which is the only way the key was
 * ever meant to be set. It is never read back: `TenantService` selects around it.
 */
export class CreateTenantDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  tenantOwnerId?: string;

  @IsString()
  status: string;

  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @IsOptional()
  @IsString()
  mainAddress?: string;

  @IsOptional()
  @IsString()
  taxNumber?: string;

  @IsOptional()
  @IsString()
  bankingAccountNumber?: string;

  @IsOptional()
  @IsString()
  bankingBankName?: string;

  @IsOptional()
  @IsString()
  bankingAccountName?: string;

  /** Platform-admin write only, never returned. See the class comment. */
  @IsOptional()
  @IsString()
  bankingSepayWebhookApiKey?: string;
}
