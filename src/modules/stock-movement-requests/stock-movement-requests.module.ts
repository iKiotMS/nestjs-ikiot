import { Module } from '@nestjs/common';
import { StockMovementRequestController } from './stock-movement-requests.controller';
import { StockMovementRequestService } from './stock-movement-requests.service';

@Module({
  controllers: [StockMovementRequestController],
  providers: [StockMovementRequestService],
  exports: [StockMovementRequestService],
})
export class StockMovementRequestModule {}
