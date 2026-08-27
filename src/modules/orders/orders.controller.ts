import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { OrderService } from './orders.service';
import { SepayOrderService } from './sepay-order.service';
import {
  CreateOrderDto,
  PayOfflineOrderDto,
  QueryOrderDto,
  UpdateOrderStatusDto,
} from './dto/order.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RawResponse } from '../../common/decorators/raw-response.decorator';
import { requireTenantId } from '../../common/utils/tenant-scope';
import type { AuthUser } from '../../common/types/auth-user.type';

/**
 * Real port of iKiotMS-BE's OrderController — same five authenticated routes and the same
 * permissions, plus the SePay webhook.
 *
 * There is no DELETE. A sale that shouldn't have happened is CANCELLED or RETURNED, both
 * of which leave a trail; the `orders:delete` pair the generated CRUD introduced is unused.
 */
@ApiTags('orders')
@ApiBearerAuth('bearer')
@Controller('orders')
export class OrderController {
  constructor(private readonly service: OrderService) {}

  @Permissions('orders', 'create')
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateOrderDto) {
    return this.service.create(requireTenantId(user), user.userId, dto);
  }

  @Permissions('orders', 'read')
  @Get()
  findAll(@CurrentUser() user: AuthUser, @Query() query: QueryOrderDto) {
    return this.service.findAll(user, requireTenantId(user), query);
  }

  @Permissions('orders', 'read')
  @Get(':id')
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.findOne(user, requireTenantId(user), id);
  }

  @Permissions('orders', 'update')
  @Patch(':id/status')
  updateStatus(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    return this.service.updateStatus(requireTenantId(user), id, dto.status);
  }

  /**
   * Settles a SePay order the customer ended up paying some other way.
   *
   * Either permission is enough, matching iKiotMS-BE's
   * `authorize("orders", ["update", "pay_offline"])` — that middleware resolved an array
   * with `.some()`, so a role holding only `orders:update` could already do this and
   * must not lose it to the port.
   */
  @Permissions('orders', 'update', 'pay_offline')
  @HttpCode(HttpStatus.OK)
  @Post(':id/pay-offline')
  payOffline(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PayOfflineOrderDto,
  ) {
    return this.service.payOffline(requireTenantId(user), id, user.userId, dto);
  }
}

/**
 * The SePay order webhook, on its own controller because its path lives outside
 * `/orders` — same layout as the subscription webhook.
 *
 * Answers 200 for every outcome, including the ones it refuses to act on: SePay retries
 * anything else, and a retry loop against our own bug is worse than a missed callback we
 * can see in the logs. Unlike the subscription webhook there is no shared secret to check
 * against — the API key **is** the tenant lookup, so an unknown one is simply "not for us".
 */
@ApiTags('orders')
@Controller('webhook/sepay')
export class SepayOrderWebhookController {
  constructor(
    private readonly service: OrderService,
    private readonly sepay: SepayOrderService,
  ) {}

  @RawResponse()
  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('order')
  async handle(
    @Headers('authorization') authHeader: string | undefined,
    @Body() payload: Record<string, unknown>,
  ) {
    try {
      if (payload.transferType !== 'in') return { success: true };

      // SePay sends "Apikey <key>", not "Bearer <key>".
      const apiKey = authHeader?.replace(/^Apikey\s+/i, '').trim() ?? '';
      const tenant = await this.sepay.findTenantByWebhookKey(apiKey);
      if (!tenant) return { success: false, message: 'Unknown API key' };

      const reference = this.sepay.extractOrderReference(
        typeof payload.content === 'string' ? payload.content : '',
      );
      if (!reference) {
        return { success: false, message: 'No order reference found' };
      }

      // SePay sends its transaction id as a number; anything else is a malformed call.
      // `null` rather than `''` for that case — it is stored on the order and the cash
      // flow as the link to the bank statement, and an empty string there would read as
      // "we have the id" to anyone reconciling.
      const transactionId =
        typeof payload.id === 'string' || typeof payload.id === 'number'
          ? String(payload.id)
          : null;

      const order = await this.service.completeSepayOrder(
        tenant.id,
        reference,
        transactionId,
        Number(payload.transferAmount ?? 0),
      );
      return order
        ? { success: true, message: 'Order payment confirmed' }
        : { success: false, message: 'Order not found or already processed' };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}
