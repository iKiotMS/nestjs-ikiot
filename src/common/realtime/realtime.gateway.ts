import { Injectable, Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemRole } from '../constants/system-role';

// Ported (with a deliberate fix) from iKiotMS-BE's src/services/socketService.js. The old
// version let ANY connected client emit `join <room>` for any room string at all,
// including `admin` — meaning any socket client could eavesdrop on admin broadcasts just
// by guessing the room name. Here, room membership is decided server-side from the JWT
// at connection time and never client-controlled: a client can never join a room it
// doesn't belong to, because there's no "join" event handler at all.
@Injectable()
@WebSocketGateway({ cors: { origin: process.env.FRONTEND_URL ?? '*' } })
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer() private server: Server;
  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token = this.extractToken(client);
      const payload = this.jwt.verify<{ sub: string }>(token);
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, tenantId: true, systemRole: true },
      });
      if (!user) throw new Error('User not found');

      await client.join(`user:${user.id}`);
      if (user.tenantId) await client.join(`tenant:${user.tenantId}`);
      if (user.systemRole === SystemRole.ADMIN) await client.join('admin');
    } catch (error) {
      this.logger.warn(
        `Rejected socket connection: ${error instanceof Error ? error.message : String(error)}`,
      );
      client.disconnect(true);
    }
  }

  handleDisconnect() {
    // socket.io leaves every room automatically on disconnect — nothing to do here.
  }

  /** The one emit primitive every other service should use — never touch `server` directly. */
  emitToRoom(room: string, event: string, payload: unknown): void {
    this.server?.to(room).emit(event, payload);
  }

  private extractToken(client: Socket): string {
    const authToken = client.handshake.auth?.token as string | undefined;
    const header = client.handshake.headers.authorization;
    const bearer =
      typeof header === 'string' ? header.split(' ')[1] : undefined;
    const token = authToken ?? bearer;
    if (!token) throw new Error('No token provided');
    return token;
  }
}
