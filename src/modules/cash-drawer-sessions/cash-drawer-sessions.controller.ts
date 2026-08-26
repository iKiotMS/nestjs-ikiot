import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CashDrawerSessionService } from './cash-drawer-sessions.service';
import {
  CurrentCashDrawerDto,
  FinalizeCashDrawerDto,
  OpenCashDrawerDto,
  QueryCashDrawerDto,
  SubmitShiftLogDto,
} from './dto/cash-drawer.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import type { AuthUser } from '../../common/types/auth-user.type';

/**
 * Real port of iKiotMS-BE's CashDrawerController — same six routes, same permissions.
 *
 * The three read routes take `cash_drawers:read` **or** `read_own`, exactly as the old
 * `authorize("cash_drawers", ["read", "read_own"])` did; which of the two the caller holds
 * then decides how much they see (see CashDrawerSessionService.ownershipFilter).
 *
 * There is no PATCH or DELETE. A till session is a record of money changing hands — it is
 * opened, logged and finalised, never edited. The `cash_drawers:create/update/delete` pairs
 * the generated CRUD introduced stay unused.
 */
@ApiTags('cash-drawer-sessions')
@ApiBearerAuth('bearer')
@Controller('cash-drawer-sessions')
export class CashDrawerSessionController {
  constructor(private readonly service: CashDrawerSessionService) {}

  @Permissions('cash_drawers', 'open')
  @Post()
  open(@CurrentUser() user: AuthUser, @Body() dto: OpenCashDrawerDto) {
    return this.service.open(user, dto);
  }

  // `current` is declared above `:id` — both are one segment deep, so the literal has to
  // come first or it is matched as a session id.
  @Permissions('cash_drawers', 'read', 'read_own')
  @Get('current')
  current(@CurrentUser() user: AuthUser, @Query() query: CurrentCashDrawerDto) {
    return this.service.current(user, query.branchId);
  }

  @Permissions('cash_drawers', 'read', 'read_own')
  @Get()
  findAll(@CurrentUser() user: AuthUser, @Query() query: QueryCashDrawerDto) {
    return this.service.findAll(user, query);
  }

  @Permissions('cash_drawers', 'read', 'read_own')
  @Get(':id')
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.findOne(user, id);
  }

  /** A cashier taking the drawer (START) or handing it back (END). */
  @Permissions('cash_drawers', 'report')
  @HttpCode(HttpStatus.OK)
  @Post(':id/shift-logs')
  submitShiftLog(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubmitShiftLogDto,
  ) {
    return this.service.submitShiftLog(user, id, dto);
  }

  /** Closes the day with a counted total. */
  @Permissions('cash_drawers', 'finalize')
  @HttpCode(HttpStatus.OK)
  @Post(':id/finalize')
  finalize(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FinalizeCashDrawerDto,
  ) {
    return this.service.finalize(user, id, dto);
  }
}
