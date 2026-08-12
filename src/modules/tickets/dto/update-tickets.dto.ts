import { PartialType } from '@nestjs/mapped-types';
import { CreateTicketDto } from './create-tickets.dto';

export class UpdateTicketDto extends PartialType(CreateTicketDto) {}
