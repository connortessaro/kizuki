const STOPWORDS = new Set(
  "a an and are as at be by for from has have in is it its of on or that the to was were will with this these those what which who how why their they them there then than so such can may also into about each most more".split(
    " ",
  ),
);

/** The distinct meaningful words of a text, lower case, without common words like "the" or "of". Numbers count, even one digit. */
export function contentWords(text: string): string[] {
  return [...new Set((text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => (w.length > 1 || /\p{N}/u.test(w)) && !STOPWORDS.has(w)))];
}

function stem(word: string): string {
  for (const suffix of ["ing", "ed", "es", "s"]) {
    if (word.length > suffix.length + 3 && word.endsWith(suffix)) return word.slice(0, -suffix.length);
  }
  return word;
}

/** True if two words are the same allowing simple endings: "release" and "releases", "diffuse" and "diffused". */
export function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  const x = stem(a);
  const y = stem(b);
  return x === y || (Math.min(x.length, y.length) >= 4 && (x.startsWith(y) || y.startsWith(x)) && Math.abs(x.length - y.length) <= 3);
}

/** How many different meaningful words of `query` appear in `text`. */
export function matchedWords(query: string, text: string): number {
  const inText = contentWords(text);
  return contentWords(query).filter((q) => inText.some((t) => sameWord(q, t))).length;
}

/** The share (0 to 1) of a sentence's meaningful words that appear in a text. A sentence with no meaningful words counts as covered. */
export function coverage(sentence: string, text: string): number {
  const words = contentWords(sentence);
  return words.length === 0 ? 1 : matchedWords(sentence, text) / words.length;
}
