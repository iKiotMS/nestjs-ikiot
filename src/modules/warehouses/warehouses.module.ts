import { Module } from '@nestjs/common';
import { WarehouseController } from './warehouses.controller';
import { WarehouseService } from './warehouses.service';

@Module({
  controllers: [WarehouseController],
  providers: [WarehouseService],
  exports: [WarehouseService],
})
export class WarehouseModule {}
