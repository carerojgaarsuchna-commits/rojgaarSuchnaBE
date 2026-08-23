/**
 * textNormalize.js
 * Simple, readable text-normalization + similarity helpers for matching.
 * No external NLP libraries — just string operations.
 */

/**
 * Normalize a title for comparison:
 * lowercase → remove punctuation → collapse whitespace
 * @param {string} str
 * @returns {string}
 */
export function normalizeTitle(str = "") {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ") // remove punctuation
    .replace(/\s+/g, " ")          // collapse whitespace
    .trim();
}

/**
 * Tokenize a normalized string into a set of words (≥2 chars).
 * @param {string} normalized
 * @returns {Set<string>}
 */
export function tokenSet(normalized) {
  return new Set(normalized.split(" ").filter((w) => w.length >= 2));
}

/**
 * Jaccard similarity between two token sets.
 * Returns 0–1.
 * @param {Set<string>} setA
 * @param {Set<string>} setB
 * @returns {number}
 */
export function jaccardSimilarity(setA, setB) {
  if (setA.size === 0 && setB.size === 0) return 1;
  const intersection = new Set([...setA].filter((t) => setB.has(t)));
  const union = new Set([...setA, ...setB]);
  return intersection.size / union.size;
}

/**
 * Token overlap score (0–100) between two raw strings.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function tokenSimilarity(a, b) {
  const setA = tokenSet(normalizeTitle(a));
  const setB = tokenSet(normalizeTitle(b));
  return Math.round(jaccardSimilarity(setA, setB) * 100);
}

/**
 * Check if a string contains any of the given keywords (case-insensitive).
 * @param {string} text
 * @param {string[]} keywords
 * @returns {boolean}
 */
export function containsAny(text, keywords) {
  const lower = text.toLowerCase();
  return keywords.some((kw) => lower.includes(kw.toLowerCase()));
}

/**
 * Clean diff text of markdown symbols, ChangeDetection tags, and extra whitespace.
 * @param {string} text
 * @returns {string}
 */
export function cleanDiffText(text = "") {
  return text
    .replace(/\(changed\)/gi, "")
    .replace(/\(into\)/gi, "")
    .replace(/[*_~`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Split diff text into individual line segments or bullet items.
 * @param {string} text
 * @returns {string[]}
 */
export function splitDiffSegments(text = "") {
  const cleaned = cleanDiffText(text);
  return cleaned
    .split(/[\r\n|•;]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 3);
}

/**
 * Extract an advertisement or notice number from text.
 * e.g. "Advt No. 01/2024" → "01/2024", "CEN 5/2025" → "5/2025"
 * Returns null if not found.
 * @param {string} text
 * @returns {string|null}
 */
export function extractAdNo(text = "") {
  if (!text) return null;
  const match = text.match(
    /(?:advt|advertisement|adv|cen|no\.?|notification)\s*[:\-.]?\s*([\d]+[\s/\-][\d]{2,4})/i
  );
  return match ? match[1].trim() : null;
}

/**
 * Check if two ad numbers are the same (normalize slashes/spaces).
 * @param {string|null} a
 * @param {string|null} b
 * @returns {boolean}
 */
export function adNoMatch(a, b) {
  if (!a || !b) return false;
  const normalize = (s) => s.replace(/[\s\-]/g, "/").toLowerCase();
  return normalize(a) === normalize(b);
}

/**
 * Detect if diff text is purely dynamic ticker noise (countdown timer, server clock, host IP changes).
 * @param {string} text
 * @returns {boolean}
 */
export function isTickerOrNoiseDiff(text = "") {
  if (!text) return false;
  const lower = text.toLowerCase();

  const tickerPatterns = [
    /end\s+after\s*:\s*\d+/i,
    /ends\s+in\s*\d+/i,
    /host\s+name\s*:/i,
    /ip\s+address\s*:\s*\d+/i,
    /\d{1,2}:\d{2}:\d{2}\s*(?:am|pm)/i,
  ];

  const matchesTicker = tickerPatterns.some((pattern) => pattern.test(text));
  if (matchesTicker) {
    const hasPdf = lower.includes(".pdf");
    const hasStrongKeyword = [
      "recruitment",
      "advertisement",
      "advt",
      "vacancy",
      "admit card",
      "cbt",
      "result",
    ].some((kw) => lower.includes(kw));
    return !hasPdf && !hasStrongKeyword;
  }

  return false;
}


