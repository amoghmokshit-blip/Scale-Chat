import * as Contacts from 'expo-contacts';
import type { ContactDiscoveryMatch } from '@scalechat/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

import { toE164India } from '@/lib/phone';
import { getJson, setJson, StorageKeys } from '@/lib/mmkv';

import { contactsRepository } from '../data';

/**
 * Device-contacts discovery pipeline.
 *
 * State machine:
 *   idle       — first mount, permission not yet checked
 *   requesting — OS permission prompt is up
 *   denied     — user said no; surface "Open Settings" affordance
 *   loading    — permission granted, reading address book + discovering matches
 *   ready      — `matches` populated and either cached (24h TTL) or fresh
 *   error      — unexpected failure (rate limit, network, etc.)
 *
 * The MMKV cache (`contacts.discovery.cache.v1`, 24h TTL) means the second
 * time the user opens Import Contacts within a day, we skip BOTH the OS
 * permission re-prompt AND the `Contacts.getContactsAsync` + discovery call.
 * The 24h window matches the BRD's "X joined ScaleChat" delayed-ping UX:
 * users who installed yesterday will discover them on next sync.
 *
 * Discovery is batched in groups of `DISCOVERY_CHUNK` so a 2500-contact phone
 * book chunks into 5 server calls, each capped at 500 phones, each counted
 * against the 10 req/min/user rate limit. We sleep briefly between chunks
 * to make abuse less attractive without hurting normal use.
 */

const DISCOVERY_CHUNK = 500;
const CHUNK_PAUSE_MS = 50;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export type DeviceContactsStatus =
  | 'idle'
  | 'requesting'
  | 'denied'
  | 'loading'
  | 'ready'
  | 'error';

type CacheEntry = {
  matches: ContactDiscoveryMatch[];
  expiresAt: number;
};

export type UseDeviceContactsResult = {
  status: DeviceContactsStatus;
  matches: ContactDiscoveryMatch[];
  /** Count of normalized E.164 phones we submitted to discovery this run. */
  scanned: number;
  /** When the result was last fetched (Date). */
  refreshedAt: Date | null;
  /** Last error message, if `status === 'error'`. */
  error: string | null;
  /** Trigger the OS permission prompt + initial fetch. Safe to call when denied. */
  requestPermission: () => Promise<void>;
  /** Bust the cache and re-fetch from device. */
  refresh: () => Promise<void>;
};

export function useDeviceContacts(): UseDeviceContactsResult {
  const [status, setStatus] = useState<DeviceContactsStatus>('idle');
  const [matches, setMatches] = useState<ContactDiscoveryMatch[]>([]);
  const [scanned, setScanned] = useState(0);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Guard against state updates after unmount — Contacts.getContactsAsync()
  // can take several seconds on phones with large address books.
  const isMounted = useRef(true);
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  /** Reads cached matches if fresh, returns null otherwise. */
  const readCache = useCallback((): CacheEntry | null => {
    const entry = getJson<CacheEntry>(StorageKeys.contactsDiscoveryCache);
    if (!entry || typeof entry.expiresAt !== 'number') return null;
    if (entry.expiresAt < Date.now()) return null;
    return entry;
  }, []);

  /** Reads device contacts, normalizes, runs discovery in chunks, caches result. */
  const runDiscovery = useCallback(async (): Promise<void> => {
    if (!isMounted.current) return;
    setStatus('loading');
    setError(null);
    try {
      const { data } = await Contacts.getContactsAsync({
        fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Name],
      });
      // Flatten phones across all device contacts, normalize to E.164,
      // drop anything that doesn't parse as a valid Indian mobile, dedup.
      const phoneSet = new Set<string>();
      for (const c of data) {
        const numbers = c.phoneNumbers ?? [];
        for (const n of numbers) {
          if (!n.number) continue;
          const e164 = toE164India(n.number);
          if (e164) phoneSet.add(e164);
        }
      }
      const phones = Array.from(phoneSet);
      if (!isMounted.current) return;
      setScanned(phones.length);

      if (phones.length === 0) {
        const entry: CacheEntry = { matches: [], expiresAt: Date.now() + CACHE_TTL_MS };
        setJson(StorageKeys.contactsDiscoveryCache, entry);
        setMatches([]);
        setRefreshedAt(new Date());
        setStatus('ready');
        return;
      }

      // Chunk the discovery calls so we respect the server's 500-phone cap
      // and stay within the 10 req/min/user rate limit.
      const aggregated: ContactDiscoveryMatch[] = [];
      for (let i = 0; i < phones.length; i += DISCOVERY_CHUNK) {
        const chunk = phones.slice(i, i + DISCOVERY_CHUNK);
        const res = await contactsRepository.discover(chunk);
        aggregated.push(...res.matches);
        if (i + DISCOVERY_CHUNK < phones.length) {
          await new Promise((resolve) => setTimeout(resolve, CHUNK_PAUSE_MS));
        }
        if (!isMounted.current) return;
      }

      const entry: CacheEntry = {
        matches: aggregated,
        expiresAt: Date.now() + CACHE_TTL_MS,
      };
      setJson(StorageKeys.contactsDiscoveryCache, entry);
      setMatches(aggregated);
      setRefreshedAt(new Date());
      setStatus('ready');
    } catch (e) {
      if (!isMounted.current) return;
      setError(e instanceof Error ? e.message : 'Failed to discover contacts.');
      setStatus('error');
    }
  }, []);

  const requestPermission = useCallback(async (): Promise<void> => {
    setStatus('requesting');
    setError(null);
    try {
      const { status: permStatus } = await Contacts.requestPermissionsAsync();
      if (permStatus !== 'granted') {
        if (isMounted.current) setStatus('denied');
        return;
      }
      await runDiscovery();
    } catch (e) {
      if (!isMounted.current) return;
      setError(e instanceof Error ? e.message : 'Could not check contacts permission.');
      setStatus('error');
    }
  }, [runDiscovery]);

  const refresh = useCallback(async (): Promise<void> => {
    // Force a fresh device read + discovery, bypassing cache.
    await runDiscovery();
  }, [runDiscovery]);

  // On first mount: try the cache, else check if permission was already
  // granted on a previous launch (don't re-prompt — let the screen decide).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cached = readCache();
      if (cached) {
        if (cancelled) return;
        setMatches(cached.matches);
        setRefreshedAt(new Date(cached.expiresAt - CACHE_TTL_MS));
        setStatus('ready');
        return;
      }
      try {
        const { status: permStatus } = await Contacts.getPermissionsAsync();
        if (cancelled) return;
        if (permStatus === 'granted') {
          await runDiscovery();
        } else if (permStatus === 'denied') {
          setStatus('denied');
        } else {
          setStatus('idle');
        }
      } catch {
        // expo-contacts can throw if the native module isn't linked yet
        // (e.g. running JS on an old dev client). Surface as idle so the
        // user sees the "Find friends" CTA; the actual error appears when
        // they tap it.
        if (!cancelled) setStatus('idle');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [readCache, runDiscovery]);

  return {
    status,
    matches,
    scanned,
    refreshedAt,
    error,
    requestPermission,
    refresh,
  };
}
