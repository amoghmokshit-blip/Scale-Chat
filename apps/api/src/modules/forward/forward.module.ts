import { Module } from '@nestjs/common';

import { BlocksModule } from '../blocks/blocks.module';
import { MessagesModule } from '../messages/messages.module';
import { ForwardController } from './forward.controller';
import { ForwardService } from './forward.service';

@Module({
  imports: [MessagesModule, BlocksModule],
  controllers: [ForwardController],
  providers: [ForwardService],
})
export class ForwardModule {}
