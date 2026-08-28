import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { accessTokenSecret } from '../../common/config/env';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { OtpService } from './otp.service';
import { RefreshTokenService } from './refresh-token.service';
import { EsmsService } from './esms.service';
import { FirebaseService } from './firebase.service';
import { WorkingScheduleModule } from '../working-schedules/working-schedules.module';

@Module({
  imports: [
    PassportModule,
    // JwtStrategy resolves shift-supervisor rights on every request — see its comment.
    WorkingScheduleModule,
    /**
     * `registerAsync`, not `register`, and the difference is load-bearing: module metadata
     * is evaluated when this file is *imported*, which happens before `ConfigModule` has
     * read `.env`. A synchronous `register({ secret: accessTokenSecret() })` therefore
     * signs with an empty string and every login 500s. The factory runs at instantiation
     * instead, by which time the environment exists.
     *
     * `ConfigService` is injected only to force that ordering — the secret itself comes
     * from `accessTokenSecret()` so the signer here and the verifier in `JwtStrategy` can
     * never end up on different keys, which is exactly what would happen if one read
     * ACCESS_TOKEN_SECRET and the other JWT_SECRET.
     */
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (_config: ConfigService) => ({
        secret: accessTokenSecret(),
        signOptions: { expiresIn: '1d' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    OtpService,
    RefreshTokenService,
    EsmsService,
    FirebaseService,
  ],
  exports: [AuthService],
})
export class AuthModule {}
