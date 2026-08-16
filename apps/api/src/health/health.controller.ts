import { Controller, Get } from '@nestjs/common';

/**
 * Liveness only — deliberately touches nothing (no Postgres, no Redis, no
 * Alchemy). An ECS/ALB target group health check firing on this decides
 * whether to keep routing traffic to this task at all; if it depended on
 * Postgres being reachable, a momentary DB blip would make ECS kill and
 * restart a perfectly healthy process, which is the opposite of rule 3
 * ("cache fails open" — the app is built to degrade gracefully when a
 * dependency is down, so its own health check shouldn't contradict that).
 * /metrics (metrics.controller.ts) is the place to look for whether
 * dependencies are actually healthy.
 */
@Controller('health')
export class HealthController {
  @Get()
  check() {
    return { status: 'ok' };
  }
}
