import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AppService } from './app.service';
import { Public } from './common/decorators/public.decorator';
import { RawResponse } from './common/decorators/raw-response.decorator';

// Replaces the Nest scaffold's "Hello World!" route. Kept (rather than deleted) because
// a load balancer / container healthcheck needs an unauthenticated endpoint to hit —
// hence @Public(), since the global JwtAuthGuard would otherwise 401 it. @RawResponse()
// for the same reason: a probe checks `{ status: "ok" }`, and a healthcheck is
// infrastructure, not part of the app's API contract.
@ApiTags('health')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Public()
  @RawResponse()
  @Get()
  root() {
    return this.appService.health();
  }

  /**
   * The path iKiotMS-BE's probe actually hits (`app.get("/health")` in its `app.js`).
   * Mounted alongside `/` so an existing Render/uptime check pointed at `/health` does not
   * start failing the moment traffic moves to this service.
   */
  @Public()
  @RawResponse()
  @Get('health')
  health() {
    return this.appService.health();
  }
}
