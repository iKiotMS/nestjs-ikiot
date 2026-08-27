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
  health() {
    return this.appService.health();
  }
}
