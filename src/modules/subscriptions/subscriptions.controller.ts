import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SubscriptionService } from './subscriptions.service';
import { SubscriptionBillingService } from './subscription-billing.service';
import { UpgradeSubscriptionDto } from './dto/upgrade-subscription.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { requireTenantId } from '../../common/utils/tenant-scope';
import { Public } from '../../common/decorators/public.decorator';
import { AdminOnlyGuard } from '../../common/guards/admin-only.guard';
import type { AuthUser } from '../../common/types/auth-user.type';

// No class-level @Controller() prefix — routes mix /subscription/* with a standalone
// /webhook/sepay path, same layout as iKiotMS-BE's single subscription router.
//
// Every tenant route below is gated: buying, upgrading and renewing spend the tenant's
// money, so they need `subscriptions:manage`, and a TENANT_OWNER passes it automatically
// (PermissionsGuard short-circuits them). These carried no @Permissions at all until
// 2026-08-20, which left any staff account able to start a paid upgrade.
@ApiTags('subscriptions')
@Controller()
export class SubscriptionController {
  constructor(
    private readonly subscriptionService: SubscriptionService,
    private readonly billingService: SubscriptionBillingService,
  ) {}

  @ApiBearerAuth('bearer')
  @Permissions('subscriptions', 'manage')
  @Post('subscription/free-trial')
  async assignFreeTrial(@CurrentUser() user: AuthUser) {
    const data = await this.subscriptionService.assignFreeTrial(
      requireTenantId(user),
      user.userId,
    );
    return { message: 'Free trial assigned successfully', data };
  }

  @ApiBearerAuth('bearer')
  @Permissions('subscriptions', 'read')
  @Get('subscription/status')
  status(@CurrentUser() user: AuthUser) {
    return this.subscriptionService.checkTrialStatus(requireTenantId(user));
  }

  @ApiBearerAuth('bearer')
  @Permissions('subscriptions', 'manage')
  @Post('subscription/upgrade/initiate')
  async initiateUpgrade(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpgradeSubscriptionDto,
  ) {
    const data = await this.billingService.initiateUpgrade(
      requireTenantId(user),
      dto.planCode,
    );
    return {
      message:
        'Payment initiated. Scan QR or transfer with the reference code.',
      data,
    };
  }

  @ApiBearerAuth('bearer')
  @Permissions('subscriptions', 'manage')
  @Post('subscription/renew/initiate')
  async initiateRenewal(@CurrentUser() user: AuthUser) {
    const data = await this.billingService.initiateRenewal(
      requireTenantId(user),
    );
    return {
      message:
        'Renewal initiated. Scan QR or transfer with the reference code.',
      data,
    };
  }

  @ApiBearerAuth('bearer')
  @UseGuards(AdminOnlyGuard)
  @Post('subscription/upgrade/:tenantId')
  async adminUpgrade(
    @CurrentUser() user: AuthUser,
    @Param('tenantId') tenantId: string,
    @Body() dto: UpgradeSubscriptionDto,
  ) {
    const data = await this.subscriptionService.adminUpgradePlan(
      tenantId,
      user.userId,
      dto.planCode,
    );
    return { message: `Successfully upgraded to ${dto.planCode}`, data };
  }

  // Called by SePay when money arrives in iKiot's own bank account. Answers 200 for every
  // outcome — SePay must not be given a reason to retry indefinitely on our bugs — except
  // a bad API key, where the service throws a 401.
  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('webhook/sepay')
  webhook(
    @Headers('authorization') authHeader: string | undefined,
    @Body() payload: Record<string, unknown>,
  ) {
    const apiKey = authHeader?.split(' ')[1] ?? '';
    return this.billingService.handleSepayWebhook(apiKey, payload);
  }
}
