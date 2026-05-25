import type {
  AddContactBody,
  BulkAddContactsBody,
  BulkAddContactsResponse,
  Contact,
  DiscoverContactsResponse,
  UpdateContactBody,
} from '@scalechat/shared';

export type ContactsListArgs = {
  cursor?: string;
  limit?: number;
  /** Trimmed free-text predicate matched against displayName + phoneE164. */
  search?: string;
};

/**
 * Seam for the `/contacts` REST endpoints. Mocked in dev with
 * `EXPO_PUBLIC_USE_MOCKS=true`; otherwise served by `api-contacts-repository`.
 *
 * `discover()` is the read side of device-contacts sync (PR 6) — stateless
 * lookup against the user table. `addMany()` is the write side called when
 * the user explicitly taps Save on discovered matches.
 */
export interface ContactsRepository {
  list(args?: ContactsListArgs): Promise<{ items: Contact[]; nextCursor: string | null }>;
  add(body: AddContactBody): Promise<Contact>;
  update(id: string, body: UpdateContactBody): Promise<Contact>;
  remove(id: string): Promise<void>;
  discover(phones: string[]): Promise<DiscoverContactsResponse>;
  addMany(body: BulkAddContactsBody): Promise<BulkAddContactsResponse>;
  subscribe(listener: () => void): () => void;
}
