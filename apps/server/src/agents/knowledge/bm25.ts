const K1 = 1.2;
const B = 0.75;

/** Words too common in English and Indonesian to say what a passage is about. */
const STOPWORDS = new Set(
  [
    // English
    'a about an and are as at be but by can did do does for from had has have he her his how ' +
      'if in into is it its me my no not of on or our she so than that the their them then ' +
      'there these they this those to was we were what when where which who why will with would ' +
      'you your',
    // Indonesian
    'ada adalah agar aku akan apa atau bagaimana bahwa banyak bisa dalam dan dari dengan di ' +
      'dia ia ini itu jadi jika juga kami kamu karena ke kita mana mereka oleh pada para saja ' +
      'saya sebagai sudah telah tentang tidak untuk yang',
  ]
    .join(' ')
    .split(' '),
);

/** Lowercased words with diacritics folded; short words and stopwords are dropped. */
export function tokenize(text: string): string[] {
  return text
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

/**
 * The `k` chunks that best match `query` by BM25 (k1 = 1.2, b = 0.75), best first; chunks
 * sharing no word with the query are left out. Ties keep the chunks' order.
 */
export function rankChunks(
  query: string,
  chunks: { id: string; text: string }[],
  k = 6,
): { id: string; score: number }[] {
  const terms = [...new Set(tokenize(query))];
  if (terms.length === 0 || chunks.length === 0) return [];
  const docs = chunks.map((c) => {
    const tf = new Map<string, number>();
    const tokens = tokenize(c.text);
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    return { id: c.id, tf, length: tokens.length };
  });
  const avg = docs.reduce((sum, d) => sum + d.length, 0) / docs.length || 1;
  const idf = new Map(
    terms.map((term) => {
      const df = docs.reduce((n, d) => n + (d.tf.has(term) ? 1 : 0), 0);
      return [term, Math.log(1 + (docs.length - df + 0.5) / (df + 0.5))];
    }),
  );
  const scored: { id: string; score: number; at: number }[] = [];
  docs.forEach((d, at) => {
    let score = 0;
    for (const term of terms) {
      const f = d.tf.get(term) ?? 0;
      if (f === 0) continue;
      score += ((idf.get(term) ?? 0) * f * (K1 + 1)) / (f + K1 * (1 - B + (B * d.length) / avg));
    }
    if (score > 0) scored.push({ id: d.id, score, at });
  });
  scored.sort((a, b) => b.score - a.score || a.at - b.at);
  return scored.slice(0, k).map(({ id, score }) => ({ id, score }));
}
