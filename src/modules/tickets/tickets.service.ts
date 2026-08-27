import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationService } from '../notifications/notifications.service';
import { TicketNotificationTemplates } from '../notifications/templates/ticket.templates';
import { RealtimeGateway } from '../../common/realtime/realtime.gateway';
import { SystemRole } from '../../common/constants/system-role';
import {
  generateReference,
  REFERENCE_PREFIX,
} from '../../common/utils/reference-generator';
import {
  paginate,
  skipFor,
  type Paginated,
} from '../../common/utils/pagination';
import type { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import type { AuthUser } from '../../common/types/auth-user.type';
import type { CreateTicketDto, ReplyTicketDto } from './dto/ticket.dto';
import { DEFAULT_TICKET_PRIORITY, TicketStatus } from './ticket.constants';

/**
 * Messages come back oldest-first so the thread reads top-to-bottom — the old model stored
 * them as an embedded array and Mongo preserved insertion order for free; here the
 * ordering has to be asked for.
 */
const WITH_MESSAGES = {
  messages: { orderBy: { createdAt: 'asc' } },
} as const;

/**
 * Ported from iKiotMS-BE's `src/modules/ticket` — support threads between a shop and the
 * platform operators.
 *
 * Two things about the old module carried over unchanged and are worth knowing:
 *
 * - **A ticket belongs to the shop, not to the person who filed it.** `/tickets/my` is
 *   named for the caller but filters on `tenantId`, so any colleague can read and answer
 *   the thread. That is intentional — support conversations outlive whoever opened them.
 * - **`isDeletedByTenant` is the only delete.** Nothing is ever removed; the flag hides the
 *   thread from the shop while operators keep seeing it, which is why the admin list
 *   deliberately does not filter on it.
 *
 * What changed: the old routes ran on bare `verifyJwt` with no `authorize()` call at all,
 * so any authenticated account could read or soft-delete any ticket it could name. They
 * are gated on the `tickets` catalog resource here, like every other ported module.
 */
@Injectable()
export class TicketService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly realtime: RealtimeGateway,
  ) {}

  /**
   * How a sender is labelled on a message. The old controller wrote
   * `profile.firstName + lastName`, falling back to email then phone — but its JWT payload
   * carried neither `profile` nor `email`, so in practice every message in production is
   * stamped with a phone number. The expression is ported as written; it resolves properly
   * now only because `JwtStrategy` re-reads the user each request (see AuthUser).
   */
  private senderName(user: AuthUser): string {
    return user.displayName ?? user.email ?? user.phoneNumber;
  }

  // ─── Shop side ─────────────────────────────────────────────────────────────

  async create(tenantId: string, user: AuthUser, dto: CreateTicketDto) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true },
    });
    const tenantName = tenant?.name ?? 'Unknown Store';

    // The old scheme was `TK-<last 6 digits of epoch ms><2 random digits>`, which recycles
    // every ~16.7 minutes against a unique column. Same generator as every other reference
    // code in this project now — see reference-generator.ts.
    const ticketId = generateReference(REFERENCE_PREFIX.TICKET);

    // The opening description is stored twice on purpose: once on the ticket, where the
    // list view reads it, and once as the first message, so the thread is self-contained.
    const ticket = await this.prisma.ticket.create({
      data: {
        ticketId,
        tenantId,
        tenantName,
        userId: user.userId,
        title: dto.title,
        description: dto.description,
        priority: dto.priority ?? DEFAULT_TICKET_PRIORITY,
        status: TicketStatus.OPEN,
        messages: {
          create: [
            {
              senderId: user.userId,
              senderName: this.senderName(user),
              senderRole: user.systemRole,
              message: dto.description,
            },
          ],
        },
      },
      include: WITH_MESSAGES,
    });

    await this.notifications.notifySystem({
      ...TicketNotificationTemplates.created(tenantName, ticketId, dto.title),
      referenceId: ticket.id,
    });
    this.realtime.emitToRoom('admin', 'ticket-update', ticket);

    return ticket;
  }

  /** Every thread the shop can still see, most recently active first. */
  findMine(tenantId: string) {
    return this.prisma.ticket.findMany({
      where: { tenantId, isDeletedByTenant: false },
      orderBy: { updatedAt: 'desc' },
      include: WITH_MESSAGES,
    });
  }

  async replyMine(
    tenantId: string,
    user: AuthUser,
    id: string,
    dto: ReplyTicketDto,
  ) {
    const existing = await this.prisma.ticket.findFirst({
      where: { id, tenantId },
      select: { status: true },
    });
    if (!existing) throw new NotFoundException('Không tìm thấy yêu cầu hỗ trợ');
    if (existing.status === TicketStatus.CLOSED) {
      throw new BadRequestException('Không thể trả lời yêu cầu đã đóng');
    }

    // Back to OPEN: the shop has said something, so the thread needs an operator again.
    const ticket = await this.appendMessage(
      id,
      user,
      dto.message,
      TicketStatus.OPEN,
    );

    this.realtime.emitToRoom('admin', 'ticket-update', ticket);
    return ticket;
  }

  // ─── Shared by both sides ──────────────────────────────────────────────────

  async findOne(user: AuthUser, id: string) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      include: WITH_MESSAGES,
    });
    if (!ticket) throw new NotFoundException('Không tìm thấy yêu cầu hỗ trợ');
    this.assertCanReach(user, ticket.tenantId);
    return ticket;
  }

  /**
   * Soft delete. The old controller set `isDeletedByTenant` whoever the caller was, so an
   * operator deleting a thread also hides it from the shop — ported as-is; the admin list
   * is the counterweight, since it shows deleted threads too.
   */
  async remove(user: AuthUser, id: string) {
    const found = await this.prisma.ticket.findUnique({
      where: { id },
      select: { tenantId: true },
    });
    if (!found) throw new NotFoundException('Không tìm thấy yêu cầu hỗ trợ');
    this.assertCanReach(user, found.tenantId);

    const ticket = await this.prisma.ticket.update({
      where: { id },
      data: { isDeletedByTenant: true, deletedAt: new Date() },
      include: WITH_MESSAGES,
    });

    // Two different events: the shop's list drops the row, the admin's list re-renders it
    // with a "deleted" badge.
    this.realtime.emitToRoom(`tenant:${ticket.tenantId}`, 'ticket-delete', {
      id,
    });
    this.realtime.emitToRoom('admin', 'ticket-update', ticket);

    return { message: 'Đã xoá yêu cầu hỗ trợ', data: ticket };
  }

  // ─── Operator side ─────────────────────────────────────────────────────────

  /**
   * Deliberately unfiltered, including threads the shop has deleted — operators need the
   * whole history, and the old admin UI renders the deleted ones with a badge.
   */
  async findAllAdmin(query: PaginationQueryDto) {
    const { page, limit } = query;
    const [tickets, total] = await Promise.all([
      this.prisma.ticket.findMany({
        orderBy: { updatedAt: 'desc' },
        skip: skipFor(page, limit),
        take: limit,
        include: WITH_MESSAGES,
      }),
      this.prisma.ticket.count(),
    ]);
    return paginate(tickets, total, page, limit) satisfies Paginated<unknown>;
  }

  async replyAdmin(user: AuthUser, id: string, dto: ReplyTicketDto) {
    await this.assertExists(id);

    const ticket = await this.appendMessage(
      id,
      user,
      dto.message,
      TicketStatus.IN_PROGRESS,
    );

    this.realtime.emitToRoom('admin', 'ticket-update', ticket);
    this.realtime.emitToRoom(
      `tenant:${ticket.tenantId}`,
      'ticket-update',
      ticket,
    );

    // The owner filed this and went back to running a shop — the socket event only lands if
    // they happen to have the app open, so the inbox row is what actually reaches them.
    const owners = await this.notifications.tenantOwners(ticket.tenantId);
    await this.notifications.notify({
      tenantId: ticket.tenantId,
      recipientIds: owners,
      ...TicketNotificationTemplates.replied(ticket.title),
      referenceId: ticket.id,
    });

    return ticket;
  }

  async closeAdmin(id: string) {
    await this.assertExists(id);

    const ticket = await this.prisma.ticket.update({
      where: { id },
      data: { status: TicketStatus.CLOSED },
      include: WITH_MESSAGES,
    });

    this.realtime.emitToRoom('admin', 'ticket-update', ticket);
    this.realtime.emitToRoom(
      `tenant:${ticket.tenantId}`,
      'ticket-update',
      ticket,
    );

    return ticket;
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  /**
   * One write for the message plus the status the sender's turn implies. The status is
   * always written even when unchanged, so `@updatedAt` bumps and the thread rises to the
   * top of both lists — the old `ticket.save()` after pushing to the embedded array did the
   * same thing implicitly.
   */
  private appendMessage(
    id: string,
    user: AuthUser,
    message: string,
    status: string,
  ) {
    return this.prisma.ticket.update({
      where: { id },
      data: {
        status,
        messages: {
          create: {
            senderId: user.userId,
            senderName: this.senderName(user),
            senderRole: user.systemRole,
            message,
          },
        },
      },
      include: WITH_MESSAGES,
    });
  }

  private async assertExists(id: string): Promise<void> {
    const found = await this.prisma.ticket.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!found) throw new NotFoundException('Không tìm thấy yêu cầu hỗ trợ');
  }

  /** A platform operator reaches every thread; anyone else only their own shop's. */
  private assertCanReach(user: AuthUser, ownerTenantId: string): void {
    if (user.systemRole === SystemRole.ADMIN) return;
    if (user.tenantId !== ownerTenantId) {
      throw new ForbiddenException('Không có quyền với yêu cầu hỗ trợ này');
    }
  }
}
