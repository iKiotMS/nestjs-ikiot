import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { paginate, skipFor } from '../../common/utils/pagination';
import {
  holidayDate,
  HolidaySource,
  HolidayType,
  yearRange,
} from './holiday.constants';
import {
  CreateHolidayDto,
  isRealCalendarDate,
  HOLIDAY_DATE_MESSAGE,
  QueryHolidayDto,
  ToggleHolidayStatusDto,
  UpdateHolidayDto,
} from './dto/holiday.dto';
import type { Prisma } from '../../../generated/prisma/client';

/**
 * The tenant's public-holiday calendar — iKiotMS-BE's `holiday` module.
 *
 * Every row here is `type: PUBLIC_HOLIDAY` with `branchId: null`; the old service pinned
 * both on every read and every write, and nothing in either codebase creates the
 * per-branch `COMPANY_HOLIDAY` variant the schema leaves room for.
 *
 * **`isManuallyEdited` is the load-bearing field.** Anything a human touches — created,
 * renamed, moved, switched off — is stamped with it, and `HolidaySyncService` then leaves
 * that row alone forever. A tenant that decides to work through a national holiday must
 * not have that decision overwritten by next month's calendar refresh.
 */
@Injectable()
export class HolidayService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(tenantId: string, query: QueryHolidayDto) {
    const where: Prisma.HolidayWhereInput = {
      tenantId,
      type: HolidayType.PUBLIC_HOLIDAY,
      branchId: null,
    };
    if (query.year !== undefined) where.date = yearRange(query.year);
    if (query.isActive !== undefined) where.isActive = query.isActive;
    if (query.source) where.source = query.source;
    if (query.name) {
      where.name = { contains: query.name, mode: 'insensitive' };
    }

    const [rows, total] = await Promise.all([
      this.prisma.holiday.findMany({
        where,
        // Chronological, not newest-first: this is a calendar, and it is read in order.
        orderBy: { date: 'asc' },
        skip: skipFor(query.page, query.limit),
        take: query.limit,
      }),
      this.prisma.holiday.count({ where }),
    ]);

    return paginate(rows, total, query.page, query.limit);
  }

  async create(tenantId: string, dto: CreateHolidayDto) {
    this.assertRealDate(dto.date);

    return this.guardDuplicate(() =>
      this.prisma.holiday.create({
        data: {
          tenantId,
          date: holidayDate(dto.date),
          name: dto.name,
          type: HolidayType.PUBLIC_HOLIDAY,
          branchId: null,
          isActive: dto.isActive ?? true,
          source: HolidaySource.MANUAL,
          // Hand-made from the start, so the sync never touches it.
          isManuallyEdited: true,
        },
      }),
    );
  }

  async update(tenantId: string, id: string, dto: UpdateHolidayDto) {
    if (dto.date === undefined && dto.name === undefined) {
      throw new BadRequestException('Phải cung cấp date hoặc name');
    }
    if (dto.date !== undefined) this.assertRealDate(dto.date);
    await this.findRow(tenantId, id);

    return this.guardDuplicate(() =>
      this.prisma.holiday.update({
        where: { id },
        data: {
          ...(dto.date !== undefined ? { date: holidayDate(dto.date) } : {}),
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          isManuallyEdited: true,
        },
      }),
    );
  }

  /** Switching a holiday off is its own route — see UpdateHolidayDto. */
  async updateStatus(
    tenantId: string,
    id: string,
    dto: ToggleHolidayStatusDto,
  ) {
    await this.findRow(tenantId, id);
    return this.prisma.holiday.update({
      where: { id },
      data: { isActive: dto.isActive, isManuallyEdited: true },
    });
  }

  /**
   * Hard delete, as the old service did. Nothing holds a foreign key to a Holiday — it is
   * consulted when payroll counts a working day, never referenced — so there is no trail
   * to preserve, and a row deleted by mistake comes back on the next sync.
   */
  async remove(tenantId: string, id: string) {
    await this.findRow(tenantId, id);
    return this.prisma.holiday.delete({ where: { id } });
  }

  private async findRow(tenantId: string, id: string) {
    const holiday = await this.prisma.holiday.findFirst({
      where: { id, tenantId },
    });
    if (!holiday) throw new NotFoundException('Không tìm thấy ngày lễ');
    return holiday;
  }

  /** `@Matches` proves the shape; this proves the day exists (rejects `2026-02-31`). */
  private assertRealDate(value: string): void {
    if (!isRealCalendarDate(value)) {
      throw new BadRequestException(HOLIDAY_DATE_MESSAGE);
    }
  }

  /**
   * `@@unique([tenantId, date, branchId, type])` backs "one holiday per date"; this turns
   * its P2002 into the message the old service sent.
   *
   * The index only does its job because of the partial-index migration that goes with it
   * — `branchId` is always NULL on these rows, and a NULL in a Postgres unique index
   * constrains nothing. See `20260827…_holiday_unique_public_per_date`.
   */
  private async guardDuplicate<T>(write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        (error as { code?: unknown }).code === 'P2002'
      ) {
        throw new ConflictException('Ngày lễ này đã tồn tại');
      }
      throw error;
    }
  }
}
