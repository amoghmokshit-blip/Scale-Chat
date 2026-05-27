import { Module } from '@nestjs/common';

import { BullMQModule } from '../../common/queues/bullmq.module';
import { BlocksModule } from '../blocks/blocks.module';
import { MessagesModule } from '../messages/messages.module';
import { PushModule } from '../push/push.module';
import {
  CallsController,
  CallsHistoryController,
  CallsWebhookController,
} from './calls.controller';
import { CallsRingTimeoutProcessor } from './calls-ring-timeout.processor';
import { CallsService } from './calls.service';
import { LiveKitClient } from './livekit.client';

@Module({
  imports: [MessagesModule, BlocksModule, BullMQModule, PushModule],
  controllers: [CallsController, CallsWebhookController, CallsHistoryController],
  providers: [CallsService, LiveKitClient, CallsRingTimeoutProcessor],
  exports: [CallsService],
})
export class CallsModule {}
