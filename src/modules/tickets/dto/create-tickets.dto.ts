import { IsBoolean, IsDateString, IsOptional, IsString } from 'class-validator';

export class CreateTicketDto {
  @IsString()
  ticketId: string;

  @IsString()
  tenantId: string;

  @IsString()
  tenantName: string;

  @IsString()
  userId: string;

  @IsString()
  title: string;

  @IsString()
  description: string;

  @IsString()
  priority: string;

  @IsString()
  status: string;

  @IsBoolean()
  isDeletedByTenant: boolean;

  @IsOptional()
  @IsDateString()
  deletedAt?: string;
}
