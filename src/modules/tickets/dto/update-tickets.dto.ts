import { PartialType } from '@nestjs/swagger';
import { CreateTicketDto } from './create-tickets.dto';

export class UpdateTicketDto extends PartialType(CreateTicketDto) {}
