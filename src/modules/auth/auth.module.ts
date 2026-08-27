import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
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
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
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
