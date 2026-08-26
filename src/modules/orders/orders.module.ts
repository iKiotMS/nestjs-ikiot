import { Module } from '@nestjs/common';
import {
  OrderController,
  SepayOrderWebhookController,
} from './orders.controller';
import { OrderService } from './orders.service';
import { SepayOrderService } from './sepay-order.service';
import { InventoryModule } from '../inventories/inventories.module';
import { NotificationModule } from '../notifications/notifications.module';

@Module({
  // InventoryModule for the stock decrement + low-stock rule, NotificationModule for the
  // "customer paid" push that a SePay transfer triggers.
  imports: [InventoryModule, NotificationModule],
  controllers: [OrderController, SepayOrderWebhookController],
  providers: [OrderService, SepayOrderService],
  exports: [OrderService],
})
export class OrderModule {}
