import { Module } from '@nestjs/common';
import { ProductItemController } from './product-items.controller';
import { ProductItemService } from './product-items.service';

@Module({
  controllers: [ProductItemController],
  providers: [ProductItemService],
  exports: [ProductItemService],
})
export class ProductItemModule {}
