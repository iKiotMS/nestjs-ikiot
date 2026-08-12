import { Module } from '@nestjs/common';
import { InventoryController } from './inventories.controller';
import { InventoryService } from './inventories.service';

@Module({
  controllers: [InventoryController],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
