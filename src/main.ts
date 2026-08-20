import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

/**
 * Which origins the browser may call this API from. `CORS_ORIGIN` is a comma-separated
 * list; leaving it unset allows any origin, which is fine for local dev and must not be
 * how production runs — set it there.
 */
function corsOrigins(): string[] | true {
  const configured = process.env.CORS_ORIGIN?.trim();
  if (!configured) return true;
  return configured
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

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

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
