/**
 * qualityGate.service.js
 * Stage 4b — Quality gate for extracted PDF text.
 *
 * Assesses whether extracted text is usable for the AI text path.
 * If it fails, the event is routed to the vision LLM path.
 *
 * Returns: { pass: boolean, score: number, reason: string, signals: {} }
 */

// ─── Recruitment vocabulary (at least 2 must be present to pass) ──────────────

const RECRUITMENT_VOCAB = [
  "vacancy",
  "vacancies",
  "post",
  "posts",
  "recruitment",
  "application",
  "apply",
  "eligibility",
  "advertisement",
  "advt",
  "qualification",
  "salary",
  "pay",
  "age",
  "last date",
  "closing date",
  "notification",
  "selection",
  "interview",
  "exam",
  "examination",
  "tender",
  "scholarship",
  "admission",
  "result",
  "merit",
  "press release",
  "notice",
  "circular",
  "corrigendum",
  "भर्ती",
  "विज्ञापन",
  "परीक्षा",
  "परिणाम",
  "आवेदन",
  "उत्तर कुंजी",
  "प्रवेश पत्र",
  "चयन",
  "प्रेस विज्ञप्ति",
];

// ─── Garbled character detection ──────────────────────────────────────────────

/**
 * Ratio of printable ASCII + common Indic script chars in the text.
 * Devanagari range: U+0900–U+097F
 * @param {string} text
 * @returns {number} 0–1
 */
function printableRatio(text) {
  if (!text.length) return 0;
  let printable = 0;
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    // Printable ASCII (32–126), newline, tab, carriage-return
    if ((code >= 32 && code <= 126) || code === 10 || code === 13 || code === 9) {
      printable++;
    }
    // Devanagari (Hindi/Marathi/Nepali)
    else if (code >= 0x0900 && code <= 0x097f) printable++;
    // Latin extended (accented chars)
    else if (code >= 0x00c0 && code <= 0x024f) printable++;
  }
  return printable / text.length;
}

/**
 * Ratio of likely garbled/garbage characters (control chars, replacement char, unusual symbols).
 * @param {string} text
 * @returns {number} 0–1
 */
function garbledRatio(text) {
  if (!text.length) return 0;
  const garbled = [...text].filter((ch) => {
    const code = ch.charCodeAt(0);
    return (
      (code < 32 && code !== 9 && code !== 10 && code !== 13) || // control chars
      code === 0xfffd || // replacement char
      (code >= 0x0080 && code <= 0x009f) // C1 control codes
    );
  });
  return garbled.length / text.length;
}

/**
 * Count how many recruitment vocabulary words appear in the text.
 * @param {string} text
 * @returns {number}
 */
function countRecruitmentKeywords(text) {
  const lower = text.toLowerCase();
  return RECRUITMENT_VOCAB.filter((word) => lower.includes(word)).length;
}

/**
 * Detect repeated garbage patterns (e.g. "???? ???? ????" repeated).
 * @param {string} text
 * @returns {boolean}
 */
function hasRepeatedGarbage(text) {
  // If more than 5% of the text is '?' characters → likely garbled encoding
  const questionMarks = (text.match(/\?/g) || []).length;
  return questionMarks / text.length > 0.05;
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Run the quality gate on extracted PDF text.
 *
 * Signal thresholds (from the plan):
 *  char count          < 200         → FAIL
 *  printable ratio     < 0.85        → FAIL
 *  garbled ratio       > 0.15        → FAIL
 *  repeated garbage    detected      → FAIL
 *  recruitment vocab   < 2 keywords  → FAIL
 *  chars per page      < 100 (multi) → FAIL
 *
 * @param {{ text:string, pageCount:number, charCount:number }} extracted
 * @returns {{ pass:boolean, score:number, reason:string, signals:{} }}
 */
export function runQualityGate(extracted) {
  const { text = "", pageCount = 1, charCount = 0 } = extracted;

  const signals = {
    char_count: charCount,
    page_count: pageCount,
    chars_per_page: pageCount > 0 ? Math.round(charCount / pageCount) : 0,
    printable_ratio: Math.round(printableRatio(text) * 100) / 100,
    garbled_ratio: Math.round(garbledRatio(text) * 100) / 100,
    recruitment_keywords_found: countRecruitmentKeywords(text),
    has_repeated_garbage: hasRepeatedGarbage(text),
  };

  const failures = [];

  // Check 1: Minimum character count (100 for single page notices, 200 for multi-page)
  const minChars = pageCount === 1 ? 100 : 200;
  if (signals.char_count < minChars) {
    failures.push(`char_count too low (${signals.char_count} < ${minChars})`);
  }

  // Check 2: Printable ratio
  if (signals.printable_ratio < 0.85) {
    failures.push(`printable_ratio too low (${signals.printable_ratio} < 0.85)`);
  }

  // Check 3: Garbled ratio
  if (signals.garbled_ratio > 0.15) {
    failures.push(`garbled_ratio too high (${signals.garbled_ratio} > 0.15)`);
  }

  // Check 4: Repeated garbage patterns
  if (signals.has_repeated_garbage) {
    failures.push("repeated garbage characters detected");
  }

  // Check 5: Recruitment vocabulary (need at least 2)
  if (signals.recruitment_keywords_found < 2) {
    failures.push(
      `recruitment_keywords too few (${signals.recruitment_keywords_found} < 2)`
    );
  }

  // Check 6: Chars per page on multi-page PDFs
  if (pageCount > 1 && signals.chars_per_page < 100) {
    failures.push(
      `chars_per_page too low on multi-page PDF (${signals.chars_per_page} < 100)`
    );
  }

  // Compute a simple quality score (0–100)
  // Starts at 100, deduct 15 per failure
  const score = Math.max(0, 100 - failures.length * 15);

  const pass = failures.length === 0;
  const reason = pass ? "Text quality acceptable" : failures.join("; ");

  return { pass, score, reason, signals };
}
