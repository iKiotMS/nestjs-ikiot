import { PartialType } from '@nestjs/mapped-types';
import { CreatePayslipDto } from './create-payslips.dto';

export class UpdatePayslipDto extends PartialType(CreatePayslipDto) {}
