import type { Contact, Message, Thread } from '../types';

/**
 * Seed data — realistic Indian names + +91 phones to match production audience
 * (CLAUDE.md §6). Used to bootstrap the mock chat repository on first launch.
 */

const NOW = Date.now();
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

export const SEED_CONTACTS: Contact[] = [
  { id: 'c-naman',  displayName: 'Naman Singh',  phoneE164: '+918976543211', emoji: '🧑🏽', tint: '#F4C66A', isOnline: true },
  { id: 'c-megha',  displayName: 'Megha Ahuja',  phoneE164: '+919811223344', emoji: '👩🏽', tint: '#F0746A' },
  { id: 'c-anand',  displayName: 'Anand Gupta',  phoneE164: '+919900112233', emoji: '🧑🏽‍💼', tint: '#F0746A' },
  { id: 'c-manaj',  displayName: 'Manaj',        phoneE164: '+917000111222', emoji: '🧑🏽', tint: '#F4C66A', isOnline: true },
  { id: 'c-priya',  displayName: 'Priya Iyer',   phoneE164: '+919620304050', emoji: '👩🏽‍💻', tint: '#7CE5B3' },
  { id: 'c-rohit',  displayName: 'Rohit Mehta',  phoneE164: '+919812121212', emoji: '🧑🏽‍🎓', tint: '#64C5FF' },
  /** Group "counterpart" — synthesised so the chat list row reuses the same Avatar/ChatRow primitives. */
  { id: 'g-college', displayName: 'College Group', emoji: '👥', tint: '#B7A6FF' },
];

/** Convenience map for screens that lookup by id. */
export const SEED_CONTACT_BY_ID: Record<string, Contact> = Object.fromEntries(
  SEED_CONTACTS.map((c) => [c.id, c])
);

/** Helper to fabricate a deterministic waveform from a seed. */
function makeWaveform(seed: number, len = 40): number[] {
  return Array.from({ length: len }, (_, i) => {
    const x = Math.sin(seed * 7.13 + i * 1.7) * 0.5 + 0.55;
    return Math.max(0.12, Math.min(1, Number(x.toFixed(2))));
  });
}

export const SEED_MESSAGES: Record<string, Message[]> = {
  't-naman': [
    { id: 'm1', threadId: 't-naman', senderId: 'c-naman', sequence: 1, createdAt: daysAgo(1), status: 'read',
      type: 'text', text: 'Hey! How’s it going?' },
    { id: 'm2', threadId: 't-naman', senderId: 'me', sequence: 2, createdAt: daysAgo(1), status: 'read',
      type: 'text', text: 'Nothing much. Just scrolling.' },
    { id: 'm3', threadId: 't-naman', senderId: 'c-naman', sequence: 3, createdAt: minutesAgo(40), status: 'read',
      type: 'text', text: 'Same here. Had lunch?' },
    { id: 'm4', threadId: 't-naman', senderId: 'me', sequence: 4, createdAt: minutesAgo(35), status: 'read',
      type: 'text', text: 'Yeah, late one 😅 You?',
      // Seeded reactions (Tranche 2.A) so the pill row renders on a fresh mock load.
      reactions: [{ emoji: '😆', count: 1, reactedByMe: false }] },
    { id: 'm5', threadId: 't-naman', senderId: 'c-naman', sequence: 5, createdAt: minutesAgo(30), status: 'read',
      type: 'text', text: 'Skipped it. Coffee saved me.',
      reactions: [{ emoji: '❤️', count: 1, reactedByMe: true }] },
    { id: 'm6', threadId: 't-naman', senderId: 'me', sequence: 6, createdAt: minutesAgo(25), status: 'read',
      type: 'voice', durationSec: 39, waveform: makeWaveform(11) },
    { id: 'm7', threadId: 't-naman', senderId: 'c-naman', sequence: 7, createdAt: minutesAgo(10), status: 'read',
      // Seeded forwarded message (Tranche 2.E) so the "↪ Forwarded" label renders
      // on a fresh mock load — counterpart side (cream bubble, blue label).
      type: 'text', text: 'Catch up later?', forwardedFromMessageId: 'seed-fwd-src-1' },
    { id: 'm8', threadId: 't-naman', senderId: 'me', sequence: 8, createdAt: minutesAgo(7), status: 'delivered',
      // Mine side (purple bubble, white-alpha label).
      type: 'text', text: 'Sure. Ping me.', forwardedFromMessageId: 'seed-fwd-src-2' },
    { id: 'm9', threadId: 't-naman', senderId: 'c-naman', sequence: 9, createdAt: minutesAgo(3), status: 'read',
      // Seeded pinned message (Tranche 2.E-front-pin) so the bubble pin pip
      // shows on a fresh mock load — counterpart side (leading pip).
      type: 'text', text: 'Done !', pinnedAt: minutesAgo(2) },
    // Seeded DOCUMENT + VIDEO (Tranche 2.C) so both bubbles render on a fresh
    // mock load. URLs are stable public sample assets so tap-to-open / play work.
    { id: 'm10', threadId: 't-naman', senderId: 'c-naman', sequence: 10, createdAt: minutesAgo(2), status: 'read',
      type: 'document', fileName: 'Trip itinerary.pdf', sizeBytes: 248_000, mimeType: 'application/pdf',
      mediaUrl: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf' },
    { id: 'm11', threadId: 't-naman', senderId: 'me', sequence: 11, createdAt: minutesAgo(1), status: 'delivered',
      type: 'video', width: 1280, height: 720, durationSec: 15,
      mediaUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4' },
  ],
  't-megha': [
    { id: 'm1', threadId: 't-megha', senderId: 'c-megha', sequence: 1, createdAt: hoursAgo(2), status: 'read',
      type: 'text', text: 'Sending the files now.' },
    { id: 'm2', threadId: 't-megha', senderId: 'me', sequence: 2, createdAt: hoursAgo(2), status: 'read',
      type: 'text', text: 'Done!' },
  ],
  't-anand': [
    { id: 'm1', threadId: 't-anand', senderId: 'c-anand', sequence: 1, createdAt: hoursAgo(4), status: 'read',
      type: 'text', text: 'Are we still on for tonight?' },
    { id: 'm2', threadId: 't-anand', senderId: 'me', sequence: 2, createdAt: hoursAgo(4), status: 'delivered',
      type: 'text', text: 'Done!' },
  ],
  't-manaj': [
    { id: 'm1', threadId: 't-manaj', senderId: 'c-manaj', sequence: 1, createdAt: minutesAgo(180), status: 'read',
      type: 'text', text: 'Done!' },
  ],
  't-priya': [
    { id: 'm1', threadId: 't-priya', senderId: 'c-priya', sequence: 1, createdAt: hoursAgo(6), status: 'read',
      type: 'text', text: 'Sharing the brief by EOD.' },
  ],
  't-rohit': [
    { id: 'm1', threadId: 't-rohit', senderId: 'c-rohit', sequence: 1, createdAt: daysAgo(2), status: 'read',
      type: 'text', text: 'See you at the meetup!' },
  ],
  't-college': [
    { id: 'm1', threadId: 't-college', senderId: 'c-priya', sequence: 1, createdAt: daysAgo(1), status: 'read',
      type: 'text', text: 'Right Tanay' },
  ],
};

function lastMessage(threadId: string): Message {
  const list = SEED_MESSAGES[threadId];
  if (!list || list.length === 0) {
    throw new Error(`seed: thread ${threadId} has no messages`);
  }
  return list[list.length - 1]!;
}

export const SEED_THREADS: Thread[] = [
  { id: 't-naman', kind: 'direct', counterpart: SEED_CONTACT_BY_ID['c-naman']!,
    lastMessage: lastMessage('t-naman'), unreadCount: 1, lastReadSequence: 7, isFavourite: true },
  { id: 't-megha', kind: 'direct', counterpart: SEED_CONTACT_BY_ID['c-megha']!,
    lastMessage: lastMessage('t-megha'), unreadCount: 1, lastReadSequence: 1 },
  { id: 't-anand', kind: 'direct', counterpart: SEED_CONTACT_BY_ID['c-anand']!,
    lastMessage: lastMessage('t-anand'), unreadCount: 0, lastReadSequence: 2 },
  { id: 't-college', kind: 'group', counterpart: SEED_CONTACT_BY_ID['g-college']!,
    lastMessage: lastMessage('t-college'), unreadCount: 0, lastReadSequence: 1 },
  { id: 't-manaj', kind: 'direct', counterpart: SEED_CONTACT_BY_ID['c-manaj']!,
    lastMessage: lastMessage('t-manaj'), unreadCount: 1, lastReadSequence: 0 },
  { id: 't-priya', kind: 'direct', counterpart: SEED_CONTACT_BY_ID['c-priya']!,
    lastMessage: lastMessage('t-priya'), unreadCount: 0, lastReadSequence: 1 },
  { id: 't-rohit', kind: 'direct', counterpart: SEED_CONTACT_BY_ID['c-rohit']!,
    lastMessage: lastMessage('t-rohit'), unreadCount: 0, lastReadSequence: 1 },
];
