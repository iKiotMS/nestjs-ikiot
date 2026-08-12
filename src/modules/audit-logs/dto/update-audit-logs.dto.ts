import { PartialType } from '@nestjs/mapped-types';
import { CreateAuditLogDto } from './create-audit-logs.dto';

export class UpdateAuditLogDto extends PartialType(CreateAuditLogDto) {}
