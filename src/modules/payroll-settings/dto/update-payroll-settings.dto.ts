import { PartialType } from '@nestjs/mapped-types';
import { CreatePayrollSettingDto } from './create-payroll-settings.dto';

export class UpdatePayrollSettingDto extends PartialType(
  CreatePayrollSettingDto,
) {}
