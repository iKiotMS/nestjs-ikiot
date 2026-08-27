import { Module } from '@nestjs/common';
import { AIChatHistoryController } from './ai-chat-histories.controller';
import { AIChatHistoryService } from './ai-chat-histories.service';
import { AiAgentService } from './ai-agent.service';
import { AiToolsService } from './ai-tools.service';
import { GeminiClient, GoogleGeminiClient } from './gemini.client';

import { ProductModule } from '../products/products.module';
import { CategoryModule } from '../categories/categories.module';
import { BrandModule } from '../brands/brands.module';
import { CustomerModule } from '../customers/customers.module';
import { BranchModule } from '../branches/branches.module';
import { WarehouseModule } from '../warehouses/warehouses.module';
import { SupplierModule } from '../suppliers/suppliers.module';
import { UserModule } from '../users/users.module';
import { AttendanceModule } from '../attendances/attendances.module';
import { LeaveRequestModule } from '../leave-requests/leave-requests.module';
import { WorkingScheduleModule } from '../working-schedules/working-schedules.module';
import { PaysheetModule } from '../paysheets/paysheets.module';
import { InventoryModule } from '../inventories/inventories.module';
import { OrderModule } from '../orders/orders.module';
import { PromotionModule } from '../promotions/promotions.module';
import { SubscriptionModule } from '../subscriptions/subscriptions.module';
import { StockMovementRequestModule } from '../stock-movement-requests/stock-movement-requests.module';
import { CashDrawerSessionModule } from '../cash-drawer-sessions/cash-drawer-sessions.module';
import { TicketModule } from '../tickets/tickets.module';
import { StatsModule } from '../stats/stats.module';

/**
 * The assistant reads the whole product through the modules that own each part of it, so it
 * imports twenty of them. That is the point rather than an accident: the alternative is a
 * second set of queries here, which would answer a shop owner with numbers that quietly
 * disagree with their own dashboard the first time a rule changed in one place and not the
 * other. Nothing imports this module back, so the graph stays acyclic.
 *
 * `GeminiClient` is bound as an abstract class rather than injected concretely — that is the
 * seam the agent's unit tests replace with a scripted model.
 */
@Module({
  imports: [
    ProductModule,
    CategoryModule,
    BrandModule,
    CustomerModule,
    BranchModule,
    WarehouseModule,
    SupplierModule,
    UserModule,
    AttendanceModule,
    LeaveRequestModule,
    WorkingScheduleModule,
    PaysheetModule,
    InventoryModule,
    OrderModule,
    PromotionModule,
    SubscriptionModule,
    StockMovementRequestModule,
    CashDrawerSessionModule,
    TicketModule,
    StatsModule,
  ],
  controllers: [AIChatHistoryController],
  providers: [
    AIChatHistoryService,
    AiAgentService,
    AiToolsService,
    { provide: GeminiClient, useClass: GoogleGeminiClient },
  ],
  exports: [AIChatHistoryService],
})
export class AIChatHistoryModule {}
