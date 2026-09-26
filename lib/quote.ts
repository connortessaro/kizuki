const WORD_CHAR = /[\p{L}\p{N}]/u;

/**
 * Puts text in a form where only the words matter: letter case, runs of spaces and line
 * breaks, curly versus straight quote marks, dash styles, and PDF ligatures (such as "ﬁ")
 * no longer make two texts differ.
 */
export function normalizeForMatch(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’‚‛′`]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐‑‒–—―−]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

const EDGE = new Set(['"', "'", " ", ".", ",", ";", ":", "!", "?", "…"]);

/** Removes quote marks, spaces, and punctuation from both ends, in one pass with no regular expression. */
function trimEdges(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && EDGE.has(text[start]!)) start += 1;
  while (end > start && EDGE.has(text[end - 1]!)) end -= 1;
  return text.slice(start, end);
}

function cleanQuote(quote: string): string {
  return trimEdges(normalizeForMatch(quote));
}

/**
 * True if the word at a quote's edge goes on past it: the next character is a letter or
 * digit, or an apostrophe followed by one (so "can" never matches inside "can't").
 */
function wordGoesOn(next: string | undefined, afterNext: string | undefined): boolean {
  if (next === undefined) return false;
  if (WORD_CHAR.test(next)) return true;
  return next === "'" && afterNext !== undefined && WORD_CHAR.test(afterNext);
}

function containsAtWordEdges(haystack: string, needle: string): boolean {
  const startsWithWord = WORD_CHAR.test(needle[0]!);
  const endsWithWord = WORD_CHAR.test(needle[needle.length - 1]!);
  let from = 0;
  for (;;) {
    const i = haystack.indexOf(needle, from);
    if (i < 0) return false;
    const end = i + needle.length;
    const okBefore = !startsWithWord || !wordGoesOn(haystack[i - 1], haystack[i - 2]);
    const okAfter = !endsWithWord || !wordGoesOn(haystack[end], haystack[end + 1]);
    if (okBefore && okAfter) return true;
    from = i + 1;
  }
}

/**
 * The quote check. True only if the quote appears word for word in the passage, after
 * {@link normalizeForMatch}. Quote marks and trailing punctuation the model wraps around a
 * quote are ignored. A quote must contain at least one letter or digit, and must not start
 * or end in the middle of a word. A word split by a hyphen at a line end also matches.
 */
export function quoteMatches(quote: string, passageText: string): boolean {
  const q = cleanQuote(quote);
  if (!q || !WORD_CHAR.test(q)) return false;
  if (containsAtWordEdges(normalizeForMatch(passageText), q)) return true;
  const joined = passageText.replace(/([\p{L}\p{N}])-[ \t]*\r?\n\s*([\p{L}\p{N}])/gu, "$1$2");
  return joined !== passageText && containsAtWordEdges(normalizeForMatch(joined), q);
}

/**
 * Finds which passage a quote comes from. Checks the passage the model cited first, then
 * the other passages it was given. Returns the id of the passage that holds the quote, or
 * `null` if none does.
 */
export function findQuote(quote: string, citedPassageId: string | undefined, passages: { passageId: string; text: string }[]): string | null {
  const cited = passages.find((p) => p.passageId === citedPassageId);
  if (cited && quoteMatches(quote, cited.text)) return cited.passageId;
  return passages.find((p) => p !== cited && quoteMatches(quote, p.text))?.passageId ?? null;
}

/** True if the words appear, word for word, in your own text. Used for "What do you mean by W?" questions. */
export function termInText(term: string, text: string): boolean {
  return quoteMatches(term, text);
}
