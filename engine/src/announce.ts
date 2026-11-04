// Screen readers (accessibility): the text a finished dialogue line is announced as, e.g. "Mina: Hello there."

/** The announcement for one line: the speaker, then the text with whitespace tidied. Null when there is nothing to say. */
export function announceLine(name: string | null | undefined, text: string): string | null {
  const body = text.replace(/\s+/g, ' ').trim();
  if (!body) return null;
  const who = (name ?? '').replace(/\s+/g, ' ').trim();
  return who ? `${who}: ${body}` : body;
}
