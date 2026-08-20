import { PartialType } from '@nestjs/swagger';
import { CreatePayrollPeriodDto } from './create-payroll-periods.dto';

export class UpdatePayrollPeriodDto extends PartialType(
  CreatePayrollPeriodDto,
) {}
