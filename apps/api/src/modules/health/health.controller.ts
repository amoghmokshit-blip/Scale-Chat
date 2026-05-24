import { Controller, Get, Inject } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  PrismaHealthIndicator,
} from '@nestjs/terminus';
import type { Redis } from 'ioredis';

import { PrismaService } from '../../common/prisma/prisma.service';
import { REDIS_CLIENT } from '../../common/redis/redis.module';

/**
 * Liveness + readiness for Fly's health checks.
 *   GET /health        — process is up (always 200 if the controller answers)
 *   GET /ready         — db + redis reachable, return 503 otherwise
 */
@Controller()
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaHealth: PrismaHealthIndicator,
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Get('health')
  liveness(): { status: 'ok'; uptimeSec: number; version: string } {
    return {
      status: 'ok',
      uptimeSec: Math.round(process.uptime()),
      version: process.env.GIT_SHA ?? 'dev',
    };
  }

  @Get('ready')
  @HealthCheck()
  async readiness() {
    return this.health.check([
      () => this.prismaHealth.pingCheck('database', this.prisma, { timeout: 1_500 }),
      async () => {
        const pong = await this.redis.ping();
        const up = pong === 'PONG';
        return { redis: { status: up ? 'up' : 'down' } };
      },
    ]);
  }
}
