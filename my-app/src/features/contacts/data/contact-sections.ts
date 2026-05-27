import type { Contact } from '@scalechat/shared';

export type ContactSection = {
  /** Single uppercase letter A–Z, or '#' for names that don't start with a letter. */
  title: string;
  data: Contact[];
};

/** First letter of a name, uppercased; non-A–Z (digits, emoji, blank) bucket to '#'. */
export function sectionLetterFor(displayName: string): string {
  const first = displayName.trim().charAt(0).toUpperCase();
  return first >= 'A' && first <= 'Z' ? first : '#';
}

/**
 * Group contacts into alphabetical sections for a `SectionList` + A–Z index.
 * Sections are sorted A→Z with '#' last; contacts within a section are sorted
 * case-insensitively by display name. Pure + side-effect-free so it's unit-
 * tested directly (see `__tests__/contact-sections.test.ts`).
 */
export function groupContactsByLetter(contacts: Contact[]): ContactSection[] {
  const byLetter = new Map<string, Contact[]>();
  for (const contact of contacts) {
    const letter = sectionLetterFor(contact.displayName);
    const bucket = byLetter.get(letter);
    if (bucket) bucket.push(contact);
    else byLetter.set(letter, [contact]);
  }

  return Array.from(byLetter.entries())
    .map(([title, data]) => ({
      title,
      data: data.sort((a, b) =>
        a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }),
      ),
    }))
    .sort((a, b) => {
      // '#' always sorts after the letters.
      if (a.title === '#') return 1;
      if (b.title === '#') return -1;
      return a.title.localeCompare(b.title);
    });
}
