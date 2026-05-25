import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  AddContactSchema,
  BulkAddContactsSchema,
  ContactsListQuerySchema,
  DiscoverContactsSchema,
  UpdateContactSchema,
  type AddContactBody,
  type BulkAddContactsBody,
  type BulkAddContactsResponse,
  type CommonGroupsListResponse,
  type Contact,
  type ContactsListQuery,
  type ContactsListResponse,
  type DiscoverContactsBody,
  type DiscoverContactsResponse,
  type UpdateContactBody,
} from '@scalechat/shared';

import { CurrentUser } from '../../common/auth/current-user.decorator';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import type { AccessTokenPayload } from '../../common/auth/jwt.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { RateLimitService } from '../../common/rate-limit/rate-limit.service';
import { ContactsService } from './contacts.service';

const DISCOVER_LIMIT_PER_MIN = 10;
const DISCOVER_WINDOW_MS = 60_000;
const BULK_LIMIT_PER_MIN = 5;
const BULK_WINDOW_MS = 60_000;

@UseGuards(JwtAuthGuard)
@Controller('contacts')
export class ContactsController {
  constructor(
    private readonly contacts: ContactsService,
    private readonly rateLimit: RateLimitService,
  ) {}

  @Get()
  list(
    @CurrentUser() user: AccessTokenPayload,
    @Query(new ZodValidationPipe(ContactsListQuerySchema)) query: ContactsListQuery
  ): Promise<ContactsListResponse> {
    return this.contacts.list(user.sub, query);
  }

  @Post()
  add(
    @CurrentUser() user: AccessTokenPayload,
    @Body(new ZodValidationPipe(AddContactSchema)) body: AddContactBody
  ): Promise<Contact> {
    return this.contacts.add(user.sub, body);
  }

  /**
   * `POST /contacts/discover` — stateless lookup. Given a batch of E.164 phones
   * (≤500), return ONLY the ones that map to existing platform users. No row
   * writes, no persistence; the device address book stays the source of truth.
   *
   * The response payload deliberately omits the matched user's `id` — the
   * static type from `@scalechat/shared` enforces this at compile time, and
   * `discoveryMatchPayload()` in the service layer rebuilds the DTO from
   * scratch rather than spreading the DB row. Per the privacy contract in
   * `docs/progress/device-contacts.md`.
   *
   * Rate-limited (10 req/min/user × 500 phones/req = 5000 phones/min ceiling)
   * so a scraper hitting random phones can't harvest the user table cheaply.
   */
  @Post('discover')
  @HttpCode(200)
  async discover(
    @CurrentUser() user: AccessTokenPayload,
    @Body(new ZodValidationPipe(DiscoverContactsSchema)) body: DiscoverContactsBody,
  ): Promise<DiscoverContactsResponse> {
    const result = await this.rateLimit.consume(
      `contacts:discover:${user.sub}`,
      DISCOVER_LIMIT_PER_MIN,
      DISCOVER_WINDOW_MS,
    );
    if (!result.allowed) {
      throw new HttpException(
        {
          code: 'rate_limited',
          message: 'Too many contact-discovery requests. Try again shortly.',
          resetInMs: result.resetInMs,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return this.contacts.discover(user.sub, body.phones);
  }

  /**
   * `POST /contacts/bulk` — write path. The Save step after Import Contacts.
   * Body is a batch of {phoneE164, displayName} entries (≤500); the service
   * silently partitions into newly-saved vs already-had and never throws on
   * the duplicate case. Caller's own phone is filtered out.
   *
   * Lower rate ceiling than `discover` (5 vs 10 / min) — saves are intentional,
   * not a hot path. The ceiling also bounds runaway storage growth from a
   * compromised client.
   */
  @Post('bulk')
  @HttpCode(200)
  async addMany(
    @CurrentUser() user: AccessTokenPayload,
    @Body(new ZodValidationPipe(BulkAddContactsSchema)) body: BulkAddContactsBody,
  ): Promise<BulkAddContactsResponse> {
    const result = await this.rateLimit.consume(
      `contacts:bulk:${user.sub}`,
      BULK_LIMIT_PER_MIN,
      BULK_WINDOW_MS,
    );
    if (!result.allowed) {
      throw new HttpException(
        {
          code: 'rate_limited',
          message: 'Too many bulk-save requests. Try again shortly.',
          resetInMs: result.resetInMs,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return this.contacts.addMany(user.sub, body);
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

  /**
   * `GET /contacts/:contactUserId/common-groups`
   *
   * Group chats both the caller and the target user are active members of.
   * Returns `{ items: [] }` until group / super-group chats ship — the shape
   * is stable so the Contact Profile screen can render against it today.
   */
  @Get(':contactUserId/common-groups')
  commonGroups(
    @CurrentUser() user: AccessTokenPayload,
    @Param('contactUserId', new ParseUUIDPipe({ version: '4' })) contactUserId: string,
  ): Promise<CommonGroupsListResponse> {
    return this.contacts.listCommonGroups(user.sub, contactUserId);
  }
}
