import { Module } from '@nestjs/common';

import { MessagesModule } from '../messages/messages.module';
import { PinController } from './pin.controller';
import { PinService } from './pin.service';

@Module({
  imports: [MessagesModule],
  controllers: [PinController],
  providers: [PinService],
})
export class PinModule {}
