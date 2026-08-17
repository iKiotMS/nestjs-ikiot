import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AppService } from './app.service';
import { Public } from './common/decorators/public.decorator';

// Replaces the Nest scaffold's "Hello World!" route. Kept (rather than deleted) because
// a load balancer / container healthcheck needs an unauthenticated endpoint to hit —
// hence @Public(), since the global JwtAuthGuard would otherwise 401 it.
@ApiTags('health')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Public()
  @Get()
  health() {
    return this.appService.health();
  }
}
