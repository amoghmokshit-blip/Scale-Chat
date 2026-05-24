import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { AppJwtService } from './jwt.service';
import { JwtAuthGuard } from './jwt-auth.guard';

/**
 * Cross-cutting auth primitives — exported globally so feature modules don't have
 * to re-import to use `@UseGuards(JwtAuthGuard)` + `@CurrentUser()`.
 */
@Global()
@Module({
  imports: [JwtModule.register({})],
  providers: [AppJwtService, JwtAuthGuard],
  exports: [AppJwtService, JwtAuthGuard, JwtModule],
})
export class AuthCommonModule {}
