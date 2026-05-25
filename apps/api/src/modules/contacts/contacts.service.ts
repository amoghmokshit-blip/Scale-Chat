import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  AddContactBody,
  BulkAddContactsBody,
  BulkAddContactsResponse,
  CommonGroupsListResponse,
  Contact,
  ContactDiscoveryMatch,
  ContactsListQuery,
  ContactsListResponse,
  DiscoverContactsResponse,
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

  async list(ownerUserId: string, query: ContactsListQuery): Promise<ContactsListResponse> {
    const { cursor, limit, search } = query;
    const c = decodeCursor(cursor, isContactCursor);

    // Search predicate: case-insensitive substring against displayName OR phone number.
    // Both columns are already indexed by the unique `(ownerUserId, phoneE164)` and the
    // implicit `displayName` btree on ordering — adequate for the Contact Page page sizes.
    const searchWhere = search
      ? {
          OR: [
            { displayName: { contains: search, mode: 'insensitive' as const } },
            { phoneE164: { contains: search } },
          ],
        }
      : {};

    // Two-tier sort: favourites first (NULLS LAST), then alphabetical by name, id as tie-breaker.
    const rows = await this.prisma.contact.findMany({
      where: { ownerUserId, ...searchWhere },
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

  /**
   * Group + Super Group chats both the caller and the target user are active
   * members of. Returns an empty list today — groups land in a later slice;
   * the shape exists so the Contact Profile screen can render against it now.
   */
  async listCommonGroups(
    callerUserId: string,
    contactUserId: string,
  ): Promise<CommonGroupsListResponse> {
    if (callerUserId === contactUserId) return { items: [] };
    const rows = await this.prisma.chat.findMany({
      where: {
        kind: { in: ['GROUP', 'SUPER_GROUP'] },
        AND: [
          { members: { some: { userId: callerUserId, leftAt: null } } },
          { members: { some: { userId: contactUserId, leftAt: null } } },
        ],
      },
      select: {
        id: true,
        title: true,
        avatarUri: true,
        _count: { select: { members: { where: { leftAt: null } } } },
      },
      orderBy: { lastMessageAt: 'desc' },
      take: 50,
    });
    return {
      items: rows.map((r) => ({
        chatId: r.id,
        title: r.title ?? 'Group',
        avatarUri: r.avatarUri ?? null,
        memberCount: r._count.members,
      })),
    };
  }

  /**
   * Stateless device-contacts lookup. Match the submitted phones against the
   * `users` table and return ONLY the on-platform matches — no row writes,
   * no persistence.
   *
   * Privacy contract (`docs/progress/device-contacts.md`):
   *   - Response payload MUST NOT include any user `id` field.
   *   - Caller's own number is silently dropped from matches (not relevant
   *     and avoids an "I am on the platform" tautology in the response).
   *   - Returned `displayName` is the platform-side `fullName`, not the
   *     contact's locally-saved display name (the caller already has that
   *     from their device).
   *
   * `phoneE164` is `@unique` on User — `IN (...)` hits the index.
   */
  async discover(callerUserId: string, phones: string[]): Promise<DiscoverContactsResponse> {
    if (phones.length === 0) return { matches: [] };
    // Dedup defensively — zod already capped at 500, but the same phone twice
    // shouldn't double-count against the user-table lookup.
    const unique = Array.from(new Set(phones));
    const users = await this.prisma.user.findMany({
      where: { phoneE164: { in: unique } },
      select: {
        // NB: NOT selecting `id`. The privacy contract demands the matched
        // user's UUID never leave the server in this payload — projecting at
        // the SQL layer means there's no way to accidentally include it on
        // the round-trip even if the DTO mapper drifts later.
        phoneE164: true,
        fullName: true,
        avatarUri: true,
      },
    });
    const matches: ContactDiscoveryMatch[] = users
      .filter((u) => u.phoneE164 !== undefined) // belt-and-braces; phoneE164 is non-null on User
      .map((u) => ({
        phoneE164: u.phoneE164,
        isOnPlatform: true as const,
        displayName: u.fullName,
        avatarUri: u.avatarUri ?? null,
      }));
    // Drop the caller's own row even if they smuggled their own phone into
    // the batch — needs a second query to learn the caller's phone, but it's
    // a `select-by-id` on the same indexed column, ~sub-ms.
    const self = await this.prisma.user.findUnique({
      where: { id: callerUserId },
      select: { phoneE164: true },
    });
    const filtered = self
      ? matches.filter((m) => m.phoneE164 !== self.phoneE164)
      : matches;
    return { matches: filtered };
  }

  /**
   * Idempotent bulk save — the write companion to `discover()`. Users land here
   * after they've ticked a subset of discovered matches and tapped Save.
   *
   * Unlike `add()`, which throws ConflictException on a duplicate, the bulk
   * path silently partitions input into `toCreate` + `alreadyHad`. The user
   * intent here is "make sure these are saved", not "fail if one exists" —
   * import UX shouldn't bail mid-batch because one number was already there.
   *
   * Self-add and dedup guards mirror `add()` but apply over the whole batch
   * in a single round-trip:
   *
   *   1. Read caller's phone once; drop any item with the same number.
   *   2. Read existing `(ownerUserId, phoneE164)` rows in one query;
   *      partition the input into `toCreate` (new) vs `alreadyHad` (skip).
   *   3. Resolve `contactUserId` for the `toCreate` phones in one query
   *      against `users.phoneE164` (indexed @unique).
   *   4. `createMany` the new rows (no `skipDuplicates` — application-level
   *      dedup is what the repo uses everywhere else; the (ownerUserId,
   *      phoneE164) unique index is the safety net).
   *   5. Re-`findMany` the freshly created rows by `(ownerUserId, phoneE164IN)`
   *      with the `contactUser.avatarUri` include so the DTO shape matches
   *      single-`add()` returns. PG `createMany` doesn't return rows.
   *
   * Tradeoff: a brief window between createMany and the re-read could see
   * concurrent writes from another transaction. In practice the rate limit
   * (5/min/user) + the (ownerUserId, phoneE164) unique constraint mean that
   * concurrent bulk saves from the same user can't double-insert; the
   * re-read just sees whichever batch landed first. Acceptable.
   */
  async addMany(
    ownerUserId: string,
    body: BulkAddContactsBody,
  ): Promise<BulkAddContactsResponse> {
    // Per-batch dedup of the client input itself — a user might tick the same
    // number twice across two device-contact entries. Keep first occurrence.
    const uniqueByPhone = new Map<string, AddContactBody>();
    for (const item of body.items) {
      if (!uniqueByPhone.has(item.phoneE164)) uniqueByPhone.set(item.phoneE164, item);
    }

    // 1. Self-add guard — drop any item with the caller's own phone.
    const self = await this.prisma.user.findUnique({
      where: { id: ownerUserId },
      select: { phoneE164: true },
    });
    if (self) uniqueByPhone.delete(self.phoneE164);

    const candidates = Array.from(uniqueByPhone.values());
    if (candidates.length === 0) {
      return { saved: [], alreadyHad: 0 };
    }
    const candidatePhones = candidates.map((c) => c.phoneE164);

    // 2. Partition against the (ownerUserId, phoneE164) unique constraint.
    const existing = await this.prisma.contact.findMany({
      where: { ownerUserId, phoneE164: { in: candidatePhones } },
      select: { phoneE164: true },
    });
    const existingPhones = new Set(existing.map((e) => e.phoneE164));
    const toCreate = candidates.filter((c) => !existingPhones.has(c.phoneE164));
    const alreadyHad = candidates.length - toCreate.length;

    if (toCreate.length === 0) {
      return { saved: [], alreadyHad };
    }

    // 3. Resolve contactUserId for any platform users matching the new phones.
    const platformUsers = await this.prisma.user.findMany({
      where: { phoneE164: { in: toCreate.map((c) => c.phoneE164) } },
      select: { id: true, phoneE164: true },
    });
    const userIdByPhone = new Map(platformUsers.map((u) => [u.phoneE164, u.id]));

    // 4. Insert + 5. re-read in one transaction so we observe the inserts
    //    consistently and can return the new rows as full DTOs.
    const savedRows = await this.prisma.$transaction(async (tx) => {
      await tx.contact.createMany({
        data: toCreate.map((c) => ({
          ownerUserId,
          contactUserId: userIdByPhone.get(c.phoneE164) ?? null,
          phoneE164: c.phoneE164,
          displayName: c.displayName,
        })),
      });
      return tx.contact.findMany({
        where: {
          ownerUserId,
          phoneE164: { in: toCreate.map((c) => c.phoneE164) },
        },
        include: { contactUser: { select: { avatarUri: true } } },
      });
    });

    return { saved: savedRows.map(toDto), alreadyHad };
  }
}
