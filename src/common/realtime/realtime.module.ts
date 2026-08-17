import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RealtimeGateway } from './realtime.gateway';

// Global so any module can inject RealtimeGateway to emit an event without importing this
// module explicitly — same reasoning as PrismaModule. Registers its own JwtModule (rather
// than depending on AuthModule's) so it has no cross-module coupling; both point at the
// same JWT_SECRET env var, so there's no risk of the two drifting apart.
@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
      }),
    }),
  ],
  providers: [RealtimeGateway],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
