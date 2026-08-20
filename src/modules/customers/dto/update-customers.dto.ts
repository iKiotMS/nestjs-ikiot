import { PartialType } from '@nestjs/swagger';
import { CreateCustomerDto } from './create-customers.dto';

export class UpdateCustomerDto extends PartialType(CreateCustomerDto) {}
