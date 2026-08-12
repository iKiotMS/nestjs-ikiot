import { Module } from '@nestjs/common';
import { TicketController } from './tickets.controller';
import { TicketService } from './tickets.service';

@Module({
  controllers: [TicketController],
  providers: [TicketService],
  exports: [TicketService],
})
export class TicketModule {}
