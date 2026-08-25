import { Module } from '@nestjs/common';
import { ProductController } from './products.controller';
import { ProductService } from './products.service';
import { SubscriptionModule } from '../subscriptions/subscriptions.module';
import { InventoryModule } from '../inventories/inventories.module';

@Module({
  // SubscriptionModule for the product quota, InventoryModule for opening stock.
  imports: [SubscriptionModule, InventoryModule],
  controllers: [ProductController],
  providers: [ProductService],
  exports: [ProductService],
})
export class ProductModule {}
