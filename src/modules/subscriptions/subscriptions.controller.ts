import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { SubscriptionService } from './subscriptions.service';
import { UpgradeSubscriptionDto } from './dto/upgrade-subscription.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { requireTenantId } from '../../common/utils/tenant-scope';
import { Public } from '../../common/decorators/public.decorator';
import { AdminOnlyGuard } from '../../common/guards/admin-only.guard';
import type { AuthUser } from '../../common/types/auth-user.type';

// No class-level @Controller() prefix — routes mix /subscription/* with a standalone
// /webhook/sepay path, same layout as iKiotMS-BE's single subscription router.
@ApiTags('subscriptions')
@Controller()
export class SubscriptionController {
  constructor(private readonly subscriptionService: SubscriptionService) {}

  @ApiBearerAuth('bearer')
  @Post('subscription/free-trial')
  async assignFreeTrial(@CurrentUser() user: AuthUser) {
    const data = await this.subscriptionService.assignFreeTrial(
      requireTenantId(user),
      user.userId,
    );
    return { message: 'Free trial assigned successfully', data };
  }

  @ApiBearerAuth('bearer')
  @Get('subscription/status')
  status(@CurrentUser() user: AuthUser) {
    return this.subscriptionService.checkTrialStatus(requireTenantId(user));
  }

  @ApiBearerAuth('bearer')
  @Post('subscription/upgrade/initiate')
  async initiateUpgrade(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpgradeSubscriptionDto,
  ) {
    const data = await this.subscriptionService.initiateUpgrade(
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
  @Post('subscription/renew/initiate')
  async initiateRenewal(@CurrentUser() user: AuthUser) {
    const data = await this.subscriptionService.initiateRenewal(
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

  // Called by SePay when money arrives in iKiot's own bank account. Always resolves with
  // HTTP 200 (except a bad API key) — SePay must not be given a reason to retry
  // indefinitely on our bugs. Status/body are set manually since they vary per case in a
  // way @HttpCode() (static) can't express.
  @Public()
  @Post('webhook/sepay')
  async webhook(
    @Headers('authorization') authHeader: string | undefined,
    @Body() payload: Record<string, unknown>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const apiKey = authHeader?.split(' ')[1] ?? '';
    const result = await this.subscriptionService.handleSepayWebhook(
      apiKey,
      payload,
    );
    res.status(result.httpStatus);
    return result.body;
  }
}
