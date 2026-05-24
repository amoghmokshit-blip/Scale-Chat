import { Module } from '@nestjs/common';

import { AuthController } from './auth.controller';
import { Msg91Service } from './services/msg91.service';
import { OtpService } from './services/otp.service';
import { TokensService } from './services/tokens.service';

@Module({
  controllers: [AuthController],
  providers: [OtpService, TokensService, Msg91Service],
  exports: [TokensService],
})
export class AuthModule {}
