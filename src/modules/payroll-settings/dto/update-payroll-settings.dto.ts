import { PartialType } from '@nestjs/swagger';
import { CreatePayrollSettingDto } from './create-payroll-settings.dto';

export class UpdatePayrollSettingDto extends PartialType(
  CreatePayrollSettingDto,
) {}
