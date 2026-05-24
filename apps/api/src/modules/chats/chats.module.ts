import { Module } from '@nestjs/common';

import { MessagesModule } from '../messages/messages.module';
import { ChatsController } from './chats.controller';
import { ChatsService } from './chats.service';

@Module({
  // `MessagesModule` exports the gateway — the read endpoint emits through it
  // so peers see read receipts arrive in real time.
  imports: [MessagesModule],
  controllers: [ChatsController],
  providers: [ChatsService],
  exports: [ChatsService],
})
export class ChatsModule {}
