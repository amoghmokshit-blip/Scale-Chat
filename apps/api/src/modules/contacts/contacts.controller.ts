import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  AddContactSchema,
  CursorQuerySchema,
  UpdateContactSchema,
  type AddContactBody,
  type Contact,
  type ContactsListResponse,
  type CursorQuery,
  type UpdateContactBody,
} from '@scalechat/shared';

import { CurrentUser } from '../../common/auth/current-user.decorator';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import type { AccessTokenPayload } from '../../common/auth/jwt.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ContactsService } from './contacts.service';

@UseGuards(JwtAuthGuard)
@Controller('contacts')
export class ContactsController {
  constructor(private readonly contacts: ContactsService) {}

  @Get()
  list(
    @CurrentUser() user: AccessTokenPayload,
    @Query(new ZodValidationPipe(CursorQuerySchema)) query: CursorQuery
  ): Promise<ContactsListResponse> {
    return this.contacts.list(user.sub, query.cursor, query.limit);
  }

  @Post()
  add(
    @CurrentUser() user: AccessTokenPayload,
    @Body(new ZodValidationPipe(AddContactSchema)) body: AddContactBody
  ): Promise<Contact> {
    return this.contacts.add(user.sub, body);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(new ZodValidationPipe(UpdateContactSchema)) body: UpdateContactBody
  ): Promise<Contact> {
    return this.contacts.update(user.sub, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string
  ): Promise<void> {
    await this.contacts.remove(user.sub, id);
  }
}
