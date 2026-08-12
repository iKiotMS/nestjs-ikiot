import { Module } from '@nestjs/common';
import { PromotionLogController } from './promotion-logs.controller';
import { PromotionLogService } from './promotion-logs.service';

@Module({
  controllers: [PromotionLogController],
  providers: [PromotionLogService],
  exports: [PromotionLogService],
})
export class PromotionLogModule {}
