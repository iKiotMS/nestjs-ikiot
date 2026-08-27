import { Module } from '@nestjs/common';
import {
  OrderController,
  SepayOrderWebhookController,
} from './orders.controller';
import { OrderService } from './orders.service';
import { SepayOrderService } from './sepay-order.service';
import { InventoryModule } from '../inventories/inventories.module';
import { NotificationModule } from '../notifications/notifications.module';
import { PromotionModule } from '../promotions/promotions.module';

@Module({
  // InventoryModule for the stock decrement + low-stock rule, NotificationModule for the
  // "customer paid" push that a SePay transfer triggers, PromotionModule so the order
  // prices its own discounts through the same engine /promotions/calculate uses rather
  // than trusting the breakdown the till sends.
  imports: [InventoryModule, NotificationModule, PromotionModule],
  controllers: [OrderController, SepayOrderWebhookController],
  providers: [OrderService, SepayOrderService],
  exports: [OrderService],
})
export class OrderModule {}
