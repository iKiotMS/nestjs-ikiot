import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminStatsService } from './admin-stats.service';
import { AdminOverviewQueryDto } from './dto/stats-query.dto';
import { AdminOnlyGuard } from '../../common/guards/admin-only.guard';

/**
 * The platform operator's dashboard. One route, and the old router put it on bare
 * `verifyJwt` with the `role === 'SUPER_ADMIN'` test written inside the handler; that test
 * is `AdminOnlyGuard` here, so it cannot be forgotten when a second admin route is added.
 *
 * No `@Permissions` on purpose: this reads across every tenant, and a platform admin holds
 * no tenant role to check a permission against.
 */
@ApiTags('stats')
@ApiBearerAuth('bearer')
@UseGuards(AdminOnlyGuard)
@Controller('stats/admin')
export class AdminStatsController {
  constructor(private readonly service: AdminStatsService) {}

  @Get('overview')
  overview(@Query() query: AdminOverviewQueryDto) {
    return this.service.getOverview(query);
  }
}
