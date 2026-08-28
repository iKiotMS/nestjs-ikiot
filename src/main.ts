// First import, deliberately: `validateEnv()` below runs before Nest is created, and
// therefore before `ConfigModule.forRoot()` has read `.env`. Without this, a developer
// whose configuration lives in `.env` rather than in real environment variables would be
// told DATABASE_URL is missing. Loading twice is harmless — dotenv never overwrites a
// variable that is already set, so real environment variables still win in production.
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { corsOrigins, validateEnv } from './common/config/env';

async function bootstrap() {
  // Before anything connects: a deploy missing JWT_SECRET must fail here, not on the first
  // login after the load balancer has already cut over to it.
  validateEnv();

  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // PrismaService and RedisService both implement OnModuleDestroy; without this they are
  // never called, because Nest only listens for SIGTERM when asked to. Render sends SIGTERM
  // on every deploy, so this is the difference between closing the pool and dropping it.
  app.enableShutdownHooks();

  // Express ignores X-Forwarded-For until it is told to trust the proxy in front of it.
  // Without this, `request.ip` is the load balancer and the header is pure client input —
  // which is exactly what AuditInterceptor records, so an untrusted header would let
  // anyone forge the IP in their own audit trail. TRUST_PROXY is the number of proxy hops
  // (usually 1); unset means "no proxy", the correct answer for local dev.
  const trustProxy = process.env.TRUST_PROXY?.trim();
  app.set('trust proxy', trustProxy ? Number(trustProxy) : false);

  app.use(
    helmet({
      // Swagger UI at /docs is served inline, so the default script/style policy blocks
      // it outright. These are the directives Nest's own helmet + Swagger recipe uses.
      contentSecurityPolicy: {
        directives: {
          defaultSrc: [`'self'`],
          styleSrc: [`'self'`, `'unsafe-inline'`],
          imgSrc: [`'self'`, 'data:', 'validator.swagger.io'],
          scriptSrc: [`'self'`, `https: 'unsafe-inline'`],
        },
      },
    }),
  );

  app.enableCors({
    origin: corsOrigins(),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  // Turns Prisma errors into real 4xx responses instead of bare 500s — see the filter.
  app.useGlobalFilters(new AllExceptionsFilter());

  const config = new DocumentBuilder()
    .setTitle('iKiotMS API')
    .setDescription(
      'NestJS/Prisma rewrite of iKiotMS-BE — see CLAUDE.md for scope and what is still unported.',
    )
    .setVersion('0.1')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'bearer',
    )
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);
  // iKiotMS-BE served its Swagger UI at /api-docs and served it unconditionally, including
  // in production. Both paths are mounted so existing bookmarks and any monitoring that
  // pings the docs keep working. If the docs should stop being public, that is a decision
  // to make deliberately here — it is not the behaviour being changed by the port.
  SwaggerModule.setup('api-docs', app, document);

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
