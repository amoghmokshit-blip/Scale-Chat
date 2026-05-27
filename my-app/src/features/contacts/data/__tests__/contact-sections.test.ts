import type { Contact } from '@scalechat/shared';

import { groupContactsByLetter, sectionLetterFor } from '@/features/contacts/data/contact-sections';

/**
 * groupContactsByLetter — drives the New Chat picker's A–Z SectionList + index.
 * Sections sort A→Z with '#' last; names within a section sort case-insensitively.
 */

function c(displayName: string): Contact {
  return {
    id: `id-${displayName}`,
    contactUserId: null,
    phoneE164: '+910000000000',
    displayName,
    favouriteAt: null,
    avatarUri: null,
    isOnPlatform: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('sectionLetterFor', () => {
  it('uppercases the first letter', () => {
    expect(sectionLetterFor('anand')).toBe('A');
    expect(sectionLetterFor('Zara')).toBe('Z');
  });

  it('buckets non-letters to #', () => {
    expect(sectionLetterFor('+91 98765')).toBe('#');
    expect(sectionLetterFor('123 Plumbing')).toBe('#');
    expect(sectionLetterFor('🙂 emoji')).toBe('#');
    expect(sectionLetterFor('   ')).toBe('#');
  });
});

describe('groupContactsByLetter', () => {
  it('groups by first letter and sorts sections A→Z', () => {
    const sections = groupContactsByLetter([c('Bhavna'), c('Anand'), c('Charu')]);
    expect(sections.map((s) => s.title)).toEqual(['A', 'B', 'C']);
    expect(sections[0]!.data.map((x) => x.displayName)).toEqual(['Anand']);
  });

  it('sorts names within a section case-insensitively', () => {
    const sections = groupContactsByLetter([c('anita'), c('Aarav'), c('Akhil')]);
    expect(sections).toHaveLength(1);
    expect(sections[0]!.data.map((x) => x.displayName)).toEqual(['Aarav', 'Akhil', 'anita']);
  });

  it('places the # bucket last', () => {
    const sections = groupContactsByLetter([c('123 Store'), c('Zoya'), c('Amit')]);
    expect(sections.map((s) => s.title)).toEqual(['A', 'Z', '#']);
  });

  it('returns an empty array for no contacts', () => {
    expect(groupContactsByLetter([])).toEqual([]);
  });
});
