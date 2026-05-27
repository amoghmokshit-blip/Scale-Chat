import type { Contact } from '@scalechat/shared';
import { useDeferredValue, useEffect, useState } from 'react';

import { contactsRepository } from '../data';

type Args = {
  /** Free-text predicate. Debounced internally via React 19's useDeferredValue. */
  search?: string;
  /**
   * Load EVERY page (loop `list({ cursor })` until `nextCursor` is null) instead
   * of just the first. The New Chat picker needs the full set to build its A–Z
   * index. Ignored while searching — the server already returns the full match
   * set for a query. Defaults to false so other consumers stay single-page.
   */
  all?: boolean;
};

type State = {
  contacts: Contact[];
  loading: boolean;
};

/**
 * Reactive contacts list. Mirrors the useThreads() pattern: imperative load +
 * repository.subscribe(refresh) for invalidation on add/update/remove.
 *
 * `search` is debounced inside the hook (not in the caller) so every consumer
 * gets the same network rhythm — useDeferredValue yields to higher-priority
 * renders before issuing the API call.
 */
export function useContacts({ search = '', all = false }: Args = {}): State {
  const deferredSearch = useDeferredValue(search.trim());
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function refresh() {
      try {
        // Loop all pages only when requested and not searching.
        if (all && !deferredSearch) {
          const acc: Contact[] = [];
          let cursor: string | undefined;
          do {
            const page = await contactsRepository.list(cursor ? { cursor } : undefined);
            acc.push(...page.items);
            cursor = page.nextCursor ?? undefined;
          } while (cursor && active);
          if (!active) return;
          setContacts(acc);
          return;
        }
        const { items } = await contactsRepository.list(
          deferredSearch ? { search: deferredSearch } : undefined,
        );
        if (!active) return;
        setContacts(items);
      } catch {
        if (active) setContacts([]);
      } finally {
        if (active) setLoading(false);
      }
    }

    refresh();
    const unsubscribe = contactsRepository.subscribe(refresh);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [deferredSearch, all]);

  return { contacts, loading };
}
