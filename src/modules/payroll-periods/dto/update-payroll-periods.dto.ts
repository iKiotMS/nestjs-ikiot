import { PartialType } from '@nestjs/mapped-types';
import { CreatePayrollPeriodDto } from './create-payroll-periods.dto';

export class UpdatePayrollPeriodDto extends PartialType(CreatePayrollPeriodDto) {}
