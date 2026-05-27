import { Module } from '@nestjs/common';

import { PushTokensController } from './push-tokens.controller';
import { PushService } from './push.service';

/**
 * Push module (Tranche 2.I). PrismaService + ConfigService are global, so no
 * imports needed. Exports PushService so CallsModule can wake a callee on ring.
 */
@Module({
  controllers: [PushTokensController],
  providers: [PushService],
  exports: [PushService],
})
export class PushModule {}
