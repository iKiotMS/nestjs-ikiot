import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SubscriptionService } from '../subscriptions/subscriptions.service';
import { LocationStatus } from '../../common/constants/location-status';
import { UserStatus } from '../../common/constants/user-status';
import {
  toAttendanceColumns,
  withNestedAttendanceLocation,
} from '../../common/dto/attendance-location.dto';
import type { AttendanceLocationDto } from '../../common/dto/attendance-location.dto';
import { paginate, skipFor } from '../../common/utils/pagination';
import { LOCATION_INCLUDE } from './location.types';
import type {
  LocationConfig,
  LocationDelegate,
  LocationRow,
  LocationWhere,
} from './location.types';

/** What both list endpoints accept — see QueryBranchDto / QueryWarehouseDto, which extend
 *  PaginationQueryDto and therefore always arrive with page/limit defaulted. */
export interface LocationQuery {
  search?: string;
  status?: string;
  page: number;
  limit: number;
}

/** The client-settable fields shared by CreateBranchDto and CreateWarehouseDto. */
export interface LocationInput {
  name?: string;
  phoneNumber?: string[];
  address?: string;
  email?: string;
  status?: string;
  attendanceTakingLocation?: AttendanceLocationDto;
}

/**
 * Everything a branch and a warehouse do identically.
 *
 * The two are deliberately near-identical modules — a tenant runs several of each and the
 * frontend treats them as the same kind of thing (see CLAUDE.md "Locations"). They used to
 * be two ~220-line services that were about 90% the same text, and that symmetry had
 * already broken once in iKiotMS-BE: BranchService refused to move a staff member out of
 * the location they already worked at, WarehouseService silently did it. Keeping one copy
 * of the rules is what stops that from happening again.
 *
 * What actually differs — the Prisma model, the quota, the User column that posts someone
 * here, and the Vietnamese wording — is passed in by the subclass as a `LocationConfig`.
 */
export abstract class LocationService<TRow extends LocationRow> {
  protected constructor(
    protected readonly prisma: PrismaService,
    protected readonly subscriptions: SubscriptionService,
    private readonly delegate: LocationDelegate<TRow>,
    private readonly config: LocationConfig,
  ) {}

  /**
   * Re-nests the flattened geofence columns into the `attendanceTakingLocation` object the
   * old API returned, so the frontend sees the same shape it always has.
   */
  protected toResponse(row: TRow) {
    return withNestedAttendanceLocation(row);
  }

  async findAll(tenantId: string, query: LocationQuery) {
    const where: LocationWhere = {
      tenantId,
      // Without an explicit filter the recycle bin stays hidden.
      status: query.status ?? { not: LocationStatus.DELETED },
    };
    if (query.search) {
      where.name = { contains: query.search, mode: 'insensitive' };
    }

    const [rows, total] = await Promise.all([
      this.delegate.findMany({
        where,
        include: LOCATION_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: skipFor(query.page, query.limit),
        take: query.limit,
      }),
      this.delegate.count({ where }),
    ]);

    return paginate(
      rows.map((row) => this.toResponse(row)),
      total,
      query.page,
      query.limit,
    );
  }

  /**
   * Always scoped by tenant, and a miss is a 404 rather than a 403: a location belonging
   * to another tenant must be indistinguishable from one that does not exist.
   */
  protected async findRow(tenantId: string, id: string): Promise<TRow> {
    const row = await this.delegate.findFirst({
      where: { id, tenantId },
      include: LOCATION_INCLUDE,
    });
    if (!row) throw new NotFoundException(this.config.messages.notFound);
    return row;
  }

  async findOne(tenantId: string, id: string) {
    return this.toResponse(await this.findRow(tenantId, id));
  }

  async create(tenantId: string, dto: LocationInput & { name: string }) {
    // Old behaviour: POST /branches sat behind requireActiveSubscription and then checked
    // the plan's quota. Both live in SubscriptionService now. (maxWarehouses is new in the
    // port — the old system let a tenant open unlimited warehouses.)
    await this.subscriptions.assertQuota(
      tenantId,
      this.config.quotaField,
      () =>
        this.delegate.count({
          where: { tenantId, status: { not: LocationStatus.DELETED } },
        }),
      this.config.messages.quotaLabel,
    );

    const row = await this.delegate.create({
      data: {
        tenantId,
        name: dto.name,
        phoneNumber: dto.phoneNumber ?? [],
        address: dto.address,
        email: dto.email,
        ...toAttendanceColumns(dto.attendanceTakingLocation),
      },
      include: LOCATION_INCLUDE,
    });
    return this.toResponse(row);
  }

  async update(tenantId: string, id: string, dto: LocationInput) {
    // Prisma's update({ where: { id } }) can't take a non-unique tenant filter, so scope
    // has to be re-checked first or any tenant could write any row by id.
    await this.findRow(tenantId, id);

    const row = await this.delegate.update({
      where: { id },
      data: {
        name: dto.name,
        phoneNumber: dto.phoneNumber,
        address: dto.address,
        email: dto.email,
        status: dto.status,
        ...toAttendanceColumns(dto.attendanceTakingLocation),
      },
      include: LOCATION_INCLUDE,
    });
    return this.toResponse(row);
  }

  /**
   * Soft delete. The old system did the same (`status: DELETED`) and a hard delete is not
   * an option anyway: users, orders, inventory, stock movements and cash flows all hold a
   * foreign key to these rows.
   */
  async remove(tenantId: string, id: string) {
    const existing = await this.findRow(tenantId, id);
    if (existing.status === LocationStatus.DELETED) {
      throw new BadRequestException(this.config.messages.alreadyDeleted);
    }

    // Not in the old system, added during the port: soft-deleting a location out from
    // under its staff left them assigned to somewhere that appears in no list.
    const staffCount = await this.prisma.user.count({
      where: {
        tenantId,
        ...this.postedAt(id),
        status: { not: UserStatus.DELETED },
      },
    });
    if (staffCount > 0) {
      throw new BadRequestException(
        this.config.messages.staffStillAttached(staffCount),
      );
    }

    const row = await this.delegate.update({
      where: { id },
      data: { status: LocationStatus.DELETED, managerId: null },
      include: LOCATION_INCLUDE,
    });
    return this.toResponse(row);
  }

  /**
   * Appoint a manager, returning the appointee.
   *
   * iKiotMS-BE did this by flipping `User.role` between STAFF and BRANCH_MANAGER /
   * WAREHOUSE_MANAGER. Those roles no longer exist — the RBAC redesign collapsed them into
   * `systemRole = STAFF` plus a tenant-defined Role — so the appointment is recorded where
   * the schema already had a place for it, `managerId`. The outgoing manager is simply
   * unlinked; their Role is left alone, because in the new model the tenant decides what a
   * manager may do.
   *
   * Subclasses wrap this to keep the response key the old API used (`branchId`/
   * `warehouseId`).
   */
  protected async appointManager(
    tenantId: string,
    locationId: string,
    staffId: string,
  ) {
    const location = await this.delegate.findFirst({
      where: {
        id: locationId,
        tenantId,
        status: { not: LocationStatus.DELETED },
      },
      include: LOCATION_INCLUDE,
    });
    if (!location) throw new NotFoundException(this.config.messages.notFound);

    const staff = await this.prisma.user.findFirst({
      where: { id: staffId, tenantId, status: UserStatus.ACTIVE },
    });
    if (!staff) {
      throw new BadRequestException(this.config.messages.staffNotEligible);
    }

    // Appointing someone must not quietly relocate them. With several branches and several
    // warehouses, "manager of X" applied to a person stationed at Y would move them out of
    // Y without anyone asking — so their current posting has to be cleared first.
    const currentPosting = staff[this.config.postingField];
    const otherPosting = staff[this.config.otherPostingField];
    if (
      (currentPosting !== null && currentPosting !== locationId) ||
      otherPosting !== null
    ) {
      throw new BadRequestException(this.config.messages.staffPostedElsewhere);
    }

    const [, updated] = await this.prisma.$transaction([
      // A user works at exactly one location, so taking this one releases the other.
      this.prisma.user.update({
        where: { id: staffId },
        data: this.postedAt(locationId, { exclusively: true }),
      }),
      this.delegate.update({
        where: { id: locationId },
        data: { managerId: staffId },
        include: LOCATION_INCLUDE,
      }),
    ]);

    return updated.manager;
  }

  /**
   * `{ branchId: id }` or `{ warehouseId: id }`, written out per case rather than with a
   * computed key so Prisma still type-checks the column name.
   */
  private postedAt(locationId: string, options?: { exclusively: boolean }) {
    const clearOther = options?.exclusively === true;
    return this.config.postingField === 'branchId'
      ? { branchId: locationId, ...(clearOther ? { warehouseId: null } : {}) }
      : { warehouseId: locationId, ...(clearOther ? { branchId: null } : {}) };
  }
}
