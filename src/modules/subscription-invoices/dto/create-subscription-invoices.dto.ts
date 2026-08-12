import { IsDateString, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateSubscriptionInvoiceDto {
  @IsString()
  subscriptionId: string;

  @IsString()
  tenantId: string;

  @IsString()
  planId: string;

  @IsNumber()
  amount: number;

  @IsString()
  currency: string;

  @IsString()
  status: string;

  @IsDateString()
  billingPeriodStart: string;

  @IsDateString()
  billingPeriodEnd: string;

  @IsOptional()
  @IsDateString()
  paidAt?: string;

  @IsOptional()
  @IsString()
  paymentReference?: string;

  @IsOptional()
  @IsString()
  paymentMethod?: string;

  @IsOptional()
  @IsString()
  transactionRef?: string;

  @IsOptional()
  @IsString()
  invoiceUrl?: string;
}
