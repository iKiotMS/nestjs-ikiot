import { PartialType } from '@nestjs/swagger';
import { CreatePayslipDto } from './create-payslips.dto';

export class UpdatePayslipDto extends PartialType(CreatePayslipDto) {}
