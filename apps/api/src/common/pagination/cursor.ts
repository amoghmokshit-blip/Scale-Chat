import { BadRequestException } from '@nestjs/common';

/**
 * Opaque cursor pagination helper.
 *
 * The mobile client must NEVER parse a cursor — it round-trips opaque strings
 * back to the server. We encode the keyset (sort field tuple) as base64url so
 * the client can't accidentally rely on the shape, and so changes to the keyset
 * are visible (old cursors decode to garbage and fail the schema check below).
 */

export type Cursor<T> = T & { readonly __cursor: never };

export function encodeCursor<T extends Record<string, string | number | null>>(payload: T): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeCursor<T extends Record<string, string | number | null>>(
  cursor: string | undefined,
  validator: (raw: unknown) => raw is T
): T | null {
  if (!cursor) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new BadRequestException({
      code: 'invalid_cursor',
      message: 'Cursor is malformed. Restart from the first page.',
    });
  }
  if (!validator(raw)) {
    throw new BadRequestException({
      code: 'invalid_cursor',
      message: 'Cursor does not match the expected shape. Restart from the first page.',
    });
  }
  return raw;
}

/**
 * Slice a fetched page (size = limit + 1) into the visible items + nextCursor.
 * Pass +1 over the user's requested limit so we can detect "is there a next page".
 */
export function buildPage<TItem>(
  fetched: TItem[],
  limit: number,
  makeCursor: (last: TItem) => string
): { items: TItem[]; meta: { nextCursor: string | null; hasMore: boolean } } {
  if (fetched.length <= limit) {
    return { items: fetched, meta: { nextCursor: null, hasMore: false } };
  }
  const items = fetched.slice(0, limit);
  const tail = items[items.length - 1];
  return {
    items,
    meta: { nextCursor: makeCursor(tail!), hasMore: true },
  };
}
