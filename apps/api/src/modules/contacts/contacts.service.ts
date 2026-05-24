import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  AddContactBody,
  Contact,
  ContactsListResponse,
  UpdateContactBody,
} from '@scalechat/shared';

import { PrismaService } from '../../common/prisma/prisma.service';
import { buildPage, decodeCursor, encodeCursor } from '../../common/pagination/cursor';

type ContactCursor = { favouriteAt: string | null; displayName: string; id: string };

function isContactCursor(raw: unknown): raw is ContactCursor {
  if (!raw || typeof raw !== 'object') return false;
  const r = raw as Record<string, unknown>;
  return (
    (r.favouriteAt === null || typeof r.favouriteAt === 'string') &&
    typeof r.displayName === 'string' &&
    typeof r.id === 'string'
  );
}

type ContactRow = {
  id: string;
  contactUserId: string | null;
  phoneE164: string;
  displayName: string;
  favouriteAt: Date | null;
  createdAt: Date;
  contactUser: { avatarUri: string | null } | null;
};

function toDto(row: ContactRow): Contact {
  return {
    id: row.id,
    contactUserId: row.contactUserId,
    phoneE164: row.phoneE164,
    displayName: row.displayName,
    favouriteAt: row.favouriteAt ? row.favouriteAt.toISOString() : null,
    avatarUri: row.contactUser?.avatarUri ?? null,
    isOnPlatform: row.contactUserId !== null,
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class ContactsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    ownerUserId: string,
    cursor: string | undefined,
    limit: number
  ): Promise<ContactsListResponse> {
    const c = decodeCursor(cursor, isContactCursor);

    // Two-tier sort: favourites first (NULLS LAST), then alphabetical by name, id as tie-breaker.
    const rows = await this.prisma.contact.findMany({
      where: { ownerUserId },
      orderBy: [{ favouriteAt: { sort: 'desc', nulls: 'last' } }, { displayName: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      ...(c
        ? {
            // Cursor pagination on a composite sort key is approximate with Prisma's keyset
            // cursor; for production we'd want a raw SQL where-clause. For the Contact Page
            // initial page sizes (≤100) Prisma's `skip:1, cursor` is sufficient and stable.
            skip: 1,
            cursor: { id: c.id },
          }
        : {}),
      include: { contactUser: { select: { avatarUri: true } } },
    });

    return buildPage(rows.map(toDto), limit, (last) =>
      encodeCursor<ContactCursor>({
        favouriteAt: last.favouriteAt,
        displayName: last.displayName,
        id: last.id,
      })
    );
  }

  async add(ownerUserId: string, body: AddContactBody): Promise<Contact> {
    // Self-add guard — saving your own phone is meaningless and breaks several invariants downstream.
    const self = await this.prisma.user.findUnique({ where: { id: ownerUserId } });
    if (self && self.phoneE164 === body.phoneE164) {
      throw new ConflictException({
        code: 'cannot_add_self',
        message: "You can't add your own phone number as a contact.",
      });
    }

    const targetUser = await this.prisma.user.findUnique({
      where: { phoneE164: body.phoneE164 },
      select: { id: true, avatarUri: true },
    });

    const existing = await this.prisma.contact.findUnique({
      where: { ownerUserId_phoneE164: { ownerUserId, phoneE164: body.phoneE164 } },
    });
    if (existing) {
      throw new ConflictException({
        code: 'contact_exists',
        message: 'You already have this phone number saved.',
      });
    }

    const created = await this.prisma.contact.create({
      data: {
        ownerUserId,
        contactUserId: targetUser?.id ?? null,
        phoneE164: body.phoneE164,
        displayName: body.displayName,
      },
      include: { contactUser: { select: { avatarUri: true } } },
    });

    return toDto(created);
  }

  async update(ownerUserId: string, contactId: string, patch: UpdateContactBody): Promise<Contact> {
    const contact = await this.prisma.contact.findFirst({
      where: { id: contactId, ownerUserId },
    });
    if (!contact) {
      throw new NotFoundException({ code: 'contact_not_found', message: 'Contact not found.' });
    }

    const updated = await this.prisma.contact.update({
      where: { id: contactId },
      data: {
        ...(patch.displayName !== undefined ? { displayName: patch.displayName } : {}),
        ...(patch.favourite !== undefined
          ? { favouriteAt: patch.favourite ? new Date() : null }
          : {}),
      },
      include: { contactUser: { select: { avatarUri: true } } },
    });

    return toDto(updated);
  }

  async remove(ownerUserId: string, contactId: string): Promise<void> {
    const result = await this.prisma.contact.deleteMany({
      where: { id: contactId, ownerUserId },
    });
    if (result.count === 0) {
      throw new NotFoundException({ code: 'contact_not_found', message: 'Contact not found.' });
    }
  }
}
