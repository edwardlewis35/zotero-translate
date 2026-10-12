/** Remove punctuation around a selected word without joining separate words. */
export function normalizeSelectedWord(text: string): string {
  return text
    .normalize("NFC")
    .replace(/\u00ad/gu, "")
    .trim()
    .replace(/^[\p{P}\p{Z}]+|[\p{P}\p{Z}]+$/gu, "");
}

type WordSegmenter = {
  segment: (
    text: string,
  ) => Iterable<{ segment: string; isWordLike?: boolean }>;
};

/**
 * Lexical detection, not a language-model guess: space-separated selections
 * remain translations, while punctuation, inflections and compound words can
 * use the dictionary prompt. Scripts without spaces need word segmentation to
 * avoid treating a whole Chinese or Japanese sentence as a single word.
 */
export function isSingleWord(text: string): boolean {
  const word = normalizeSelectedWord(text);
  if (!word || Array.from(word).length > 80) return false;
  if (
    !/\p{L}/u.test(word) ||
    !/^[\p{L}\p{N}][\p{L}\p{M}\p{N}]*(?:['’ʼ\u2010\u2011-][\p{L}\p{N}][\p{L}\p{M}\p{N}]*)*$/u.test(
      word,
    )
  )
    return false;

  if (/\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}/u.test(word)) {
    const Segmenter = (
      Intl as unknown as {
        Segmenter?: new (
          locale: string,
          options: { granularity: "word" },
        ) => WordSegmenter;
      }
    ).Segmenter;
    // Hosts without segmentation should not misclassify a complete sentence.
    if (!Segmenter) return Array.from(word).length === 1;
    try {
      const segments = Array.from(
        new Segmenter("und", { granularity: "word" }).segment(word),
      );
      return (
        segments.length === 1 &&
        segments[0].isWordLike === true &&
        segments[0].segment === word
      );
    } catch {
      return Array.from(word).length === 1;
    }
  }
  return true;
}
