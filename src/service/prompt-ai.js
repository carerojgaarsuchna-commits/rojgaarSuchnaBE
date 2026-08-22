"use strict";

// ═════════════════════════════════════════════════════════════════════════════
// Rojgaar Suchna — LLM Prompt Builders (2-Pass Adaptive Pipeline)
//
// ChangeDetection
//      ↓
// PASS 1  buildPass1Prompt(payload)
//   Relevance + Extraction + PDF Discovery, merged.
//   Output → Pass1ResponseSchema: { relevant:false, reason }
//                              OR { relevant:true, watch_uuid, items:[...] }
//   Each item matches Pass1ItemSchema (title, original_title, summary,
//   source_url, department, body, category, notification_type,
//   notification_date, application_last_date, new_or_updated, confidence,
//   raw_explanation, pdf_url, pdf_needs_backend_fetch, is_duplicate).
//      ↓
// Backend — per item, IF pdf_url present: download PDF, extract text
// (pdf_needs_backend_fetch on the item is informational only — the backend
// decides whether to fetch based on pdf_url being non-null, never on trusting
// this boolean blindly.)
//      ↓
// PASS 2  buildPass2Prompt(item, pdfText)   — only runs if PDF text extracted
//   Refine the single item using the official PDF text as ground truth,
//   and produce the SEO blog article.
//   Output → Pass2ItemSchema (title, original_title, summary, source_url,
//   pdf_url, department, body, category, notification_type,
//   notification_date, application_last_date, new_or_updated, confidence,
//   raw_explanation, markdown_body). No is_duplicate, no
//   pdf_needs_backend_fetch — those are Pass-1-only / backend-only concerns.
//      ↓
// Backend — deterministic dedupe_hash (watch_uuid + normalized(title) +
// notification_date) → MongoDB atomic upsert → duplicate:skip / new:save
//
// No LLM in this pipeline ever makes the duplicate/new decision. is_duplicate
// on a Pass 1 item is always false — a fixed schema placeholder, not a real
// judgment. Real dedup happens after both passes, deterministically.
// ═════════════════════════════════════════════════════════════════════════════

const ALLOWED_CATEGORIES = [
    "Job", "Result", "Admit Card", "Answer Key", "Syllabus",
    "Admission", "Notice", "Scholarship", "Tender",
];

// ─────────────────────────────────────────────────────────────────────────────
// PASS 1 — Relevance + Extraction + PDF Discovery
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {Object} payload
 * @param {string} payload.watch_uuid
 * @param {string} payload.watch_title
 * @param {string} payload.watch_url
 * @param {string} payload.change_datetime
 * @param {string} [payload.diff_added]
 * @param {string} [payload.diff]
 * @param {string} [payload.snapshot]  - cleaned HTML snapshot, used for PDF discovery only
 * @returns {string} prompt text
 */
export function buildPass1Prompt(payload) {
    const {
        watch_uuid,
        watch_title,
        watch_url,
        change_datetime,
        diff_added,
        diff,
        snapshot,
    } = payload || {};

    if (!watch_uuid || !watch_title || !watch_url || !change_datetime) {
        throw new Error(
            "buildPass1Prompt: watch_uuid, watch_title, watch_url, and change_datetime are required"
        );
    }

    const primaryChange =
        typeof diff_added === "string" && diff_added.trim()
            ? diff_added
            : typeof diff === "string"
                ? diff
                : "";

    const hasSnapshot = typeof snapshot === "string" && snapshot.trim().length > 0;

    return `
You are the Relevance + Extraction + Document Discovery Engine for
"Rojgaar Suchna".

You perform THREE jobs in one pass on a single detected website change:

1. Decide whether the change contains meaningful candidate-related
   information (relevance).
2. If relevant, extract ONE OR MORE structured notification items from it.
3. For each item, look for an associated official document (PDF or similar)
   in the supplied website snapshot, IF a snapshot is provided.

A single diff can legitimately contain MULTIPLE unrelated notices bundled
together (confirmed from real payloads — a page diff can list several
separate recruitment/result notices in one change). When this happens,
return one item per distinct notice. Do not merge unrelated notices into one
item, and do not split a single notice into several.

You are NOT responsible for:
- downloading any document
- reading PDF contents (you have not seen inside any PDF)
- duplicate detection of any kind
- computing a dedupe key
- database writes or database history lookups
- constructing or repairing URLs
- generating the SEO blog article (that happens in a later stage)

==================================================
SOURCE CONTEXT
==================================================

Watch UUID: ${watch_uuid}
Website Name: ${watch_title}
Website URL: ${watch_url}
Detected At: ${change_datetime}

==================================================
WEBSITE CHANGE CONTENT
==================================================

${primaryChange}

==================================================
WEBSITE SNAPSHOT (for document discovery only)
==================================================

${hasSnapshot ? snapshot : "NOT PROVIDED — no document discovery is possible for this event."}

==================================================
SOURCE RULES
==================================================

1. Prefer diff_added as the source of newly appeared content; fall back to
   diff only if diff_added is empty.
2. Do not treat removed-only content as a new notification.
3. Do not infer information that is not explicitly present in the change
   content.
4. Ignore HTML/CSS/JavaScript formatting noise.

==================================================
RELEVANCE — WHEN relevant = true
==================================================

The change contains meaningful information related to candidates,
recruitment, examinations, admissions, results, or government notifications:
job vacancy, recruitment advertisement, result, merit list, cut-off, admit
card, call letter, answer key, admission, counselling, syllabus, exam
schedule, interview schedule, document verification, medical examination,
PET, CBT, shortlist, application status, city intimation, corrigendum,
scholarship, or other genuine candidate-related notice.

==================================================
RELEVANCE — WHEN relevant = false
==================================================

The change is only: visitor counter, IP address, server info, captcha,
accessibility text, footer, copyright, CSS, JavaScript, logo, banner, image,
menu, breadcrumb, contact info, social links, formatting/whitespace changes,
table reordering, unchanged duplicate content, commercial advertisements,
generic "Download/View/Login/Click Here" buttons, a generic PDF link with no
notification context, or other technical/website noise.

A PDF or download link by itself is NOT evidence of relevance.

Be conservative. If evidence is insufficient, return relevant = false. Do
not guess.

==================================================
DOCUMENT DISCOVERY (per item, only if a snapshot was provided)
==================================================

For each relevant item, search the snapshot for the official document
associated with THAT specific notice.

1. The document must be clearly associated with the notice being processed
   — not the first PDF on the page, not something from a header, menu,
   archive, or unrelated section.
2. Never invent a filename, path, or URL. Never modify an observed filename.
   Preserve exact spelling, capitalization, and path.
3. If a complete https:// URL is visible, use it exactly as pdf_url.
4. If only a filename or relative path is visible (e.g.
   "14082026-864_0001.pdf" or "/uploads/notice/14082026.pdf"), put that
   exact string in pdf_url as-is. Do NOT convert it into a full URL, do NOT
   guess a directory, do NOT append an extension.
5. Documents may be .pdf, .doc, .docx, .xls, .xlsx, .aspx, .php, or
   extensionless — treat a clearly identified official attachment as a
   document regardless of extension.
6. If no reliable associated document is found, pdf_url must be null.

pdf_needs_backend_fetch:
  true if you set pdf_url to a non-null value, false if pdf_url is null.
  Purely mechanical, derived from whether you found a document reference.

==================================================
PER-ITEM FIELD RULES
==================================================

title:
  SEO-friendly title, ~40-80 characters, primary keyword near the start.
  Style examples only (do not copy facts from them): "RRB Technician
  Recruitment 2026", "SSC CGL 2026 Exam Date Released".

original_title:
  Exact official notification/document title ONLY if explicitly visible in
  the change content. Do not rewrite it. If it cannot be established,
  return an empty string "" — do not fabricate one, and do not omit the
  field.

summary:
  2-3 short sentences: what the notice is about, what candidates should
  know, what action is explicitly supported by the source. No unsupported
  detail.

source_url:
  MUST equal exactly: ${watch_url}
  Never replace with pdf_url. Never modify.

department:
  Ministry/department/commission/board/organization, only if explicitly
  supported. "" if not available. Never inferred from general knowledge.

body:
  Official recruiting/exam/admitting organization name, from the change
  content only. "" if not available.

category: exactly one of
  ${ALLOWED_CATEGORIES.map((c) => `"${c}"`).join(" | ")}
  Determine from actual content, not from what the website is generally
  known for.

notification_type:
  A specific type supported by the source (e.g. Recruitment Advertisement,
  Corrigendum, Result, Admit Card, Answer Key, Exam Schedule, Shortlist,
  Interview Schedule, Document Verification, Application Status, City
  Intimation, Admission Notice, Scholarship Notice, Tender Notice, Notice).
  Do not invent a more specific type than the source supports.

notification_date:
  Official publication/notification date ONLY — never change_datetime,
  never a deadline, never an exam date. Government sources commonly show
  dates as DD-MM-YYYY or DD/MM/YYYY; normalize into YYYY-MM-DD without
  changing the actual date. "" if not explicitly stated.

application_last_date:
  Final application/submission deadline only, YYYY-MM-DD (same
  normalization rule as above). Do not confuse with notification date,
  application start date, exam date, or result date. "" if not available.

new_or_updated: exactly "New" or "Updated"
  NEW: newly published notification/result/admit card/answer key/schedule.
  UPDATED: corrigendum, revision, extension, modification, correction.
  Determine from the content itself — never from database history.

confidence:
  Integer 0-100, reflecting completeness/quality of the change content
  available to you at THIS stage (before any PDF has been read).
    80-100: change content itself is detailed and unambiguous
    60-79:  useful information but some important details missing
    below 60: limited or ambiguous change content
  Do not give high confidence merely because a pdf_url was found — you have
  not read that document yet.

raw_explanation:
  Short internal note: what was extracted, what was missing, whether a
  document reference was found.

is_duplicate:
  ALWAYS false. You must never perform duplicate detection, never inspect
  database history, never compare against prior notifications. Real
  deduplication happens entirely outside this call via a deterministic hash
  and an atomic database check.

==================================================
GLOBAL FACTUAL RULES (apply to every item)
==================================================

Never fabricate or guess: vacancy numbers, post names, dates, application
deadlines, fees, eligibility, qualifications, age limits/relaxations,
salary/pay scale, selection stages, exam dates, application procedure,
required documents, result info, admit-card info, answer-key info,
scholarship/tender details, or URLs. Never infer facts from a filename or
URL. If a fact is unavailable, use the schema-compatible empty value ("" or
null) — never omit the field itself.

==================================================
OUTPUT CONTRACT
==================================================

Return ONLY valid JSON. No markdown, no code fences, no prose outside JSON.

If not relevant:

{
  "relevant": false,
  "reason": "Short factual explanation."
}

If relevant:

{
  "relevant": true,
  "watch_uuid": "${watch_uuid}",
  "items": [
    {
      "title": "",
      "original_title": "",
      "summary": "",
      "source_url": "",
      "department": "",
      "body": "",
      "category": "",
      "notification_type": "",
      "notification_date": "",
      "application_last_date": "",
      "new_or_updated": "New",
      "confidence": 0,
      "raw_explanation": "",
      "pdf_url": null,
      "pdf_needs_backend_fetch": false,
      "is_duplicate": false
    }
  ]
}

==================================================
FINAL VALIDATION (silent, before responding)
==================================================

1. Output is exactly one JSON object, nothing outside it.
2. relevant is boolean; items exists (non-empty array) iff relevant=true.
3. Every item has exactly the 15 fields shown above, no extras.
4. category is exactly one allowed value per item.
5. source_url equals ${watch_url} exactly, in every item.
6. pdf_needs_backend_fetch is true iff pdf_url is non-null.
7. is_duplicate is exactly false in every item.
8. original_title is "" when no exact title is available — never omitted,
   never fabricated.
9. Dates are YYYY-MM-DD or "" — never change_datetime, never guessed.
10. If multiple distinct notices exist in the change content, each has its
    own item; unrelated notices are never merged.

RETURN ONLY THE JSON OBJECT.
`;
}

// ─────────────────────────────────────────────────────────────────────────────
// PASS 2 — PDF Refinement + Blog Generation (single item)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Refines a single Pass 1 item using extracted official PDF text, and
 * generates the SEO blog article. Only called when a PDF was successfully
 * downloaded and text was extracted.
 *
 * @param {Object} item     - the Pass 1 item object (post-evidence-gate)
 * @param {string} pdfText  - extracted, already-truncated PDF text
 * @returns {string} prompt text
 */
export function buildPass2Prompt(item, pdfText) {
    if (!item || typeof item !== "object") {
        throw new Error("buildPass2Prompt: item is required");
    }
    if (typeof pdfText !== "string" || !pdfText.trim()) {
        throw new Error("buildPass2Prompt: non-empty pdfText is required");
    }

    return `
You are the PDF Refinement + Blog Generation Engine for "Rojgaar Suchna".

You are given a preliminary notification item (extracted from a website
change, before the official document was read) and the extracted text of
the official PDF/document associated with it.

Your job:

1. Refine/correct the notification fields using the PDF text as the
   authoritative source. The PDF text overrides the preliminary item
   wherever they conflict.
2. Generate a complete human-friendly SEO blog article in markdown_body.

You are NOT responsible for:
- deciding relevance (already decided)
- finding or re-finding the document (already found and downloaded)
- duplicate detection of any kind
- database writes

==================================================
PRELIMINARY ITEM (from website change, before PDF was read)
==================================================

${JSON.stringify(item, null, 2)}

IMPORTANT:
This is preliminary context only. When the PDF text provides a different
or more complete value for any field, the PDF text wins. Do not blindly
copy the preliminary item's values.

==================================================
OFFICIAL PDF TEXT (authoritative)
==================================================

${pdfText}

==================================================
GLOBAL FACTUAL RULES
==================================================

Never fabricate or guess: vacancy numbers, post names, dates, application
deadlines, fees, eligibility, qualifications, age limits/relaxations,
salary/pay scale, selection stages, exam dates, application procedure,
required documents, result info, admit-card info, answer-key info,
scholarship/tender details, or URLs. Never infer facts from the PDF's
filename or URL — only from its extracted text. If a fact is not present
in the PDF text or the preliminary item, use the schema-compatible empty
value ("" ) — never invent one.

==================================================
FIELD RULES
==================================================

title:
  SEO-friendly title, ~40-80 characters, primary keyword near the start,
  refined from the PDF text if it changes the picture.

original_title:
  Exact official title as it appears in the PDF text. "" if not present.

summary:
  2-3 short sentences reflecting the PDF's actual content.

source_url:
  Keep exactly as supplied in the preliminary item. Never modify.

pdf_url:
  Keep exactly as supplied in the preliminary item. Never modify, never
  reconstruct.

department:
  From the PDF text if present, else keep the preliminary value, else "".

body:
  Official recruiting/exam/admitting organization name from the PDF text.

category: exactly one of
  ${ALLOWED_CATEGORIES.map((c) => `"${c}"`).join(" | ")}
  Re-evaluate using the PDF text; correct the preliminary value if wrong.

notification_type:
  A specific type supported by the PDF text. Do not invent a more specific
  type than the source supports.

notification_date:
  Official publication/notification date from the PDF text. Government
  documents commonly show DD-MM-YYYY or DD/MM/YYYY; normalize to
  YYYY-MM-DD without changing the actual date. "" if not stated. Never a
  deadline, exam date, or detection date.

application_last_date:
  Final application/submission deadline from the PDF text, YYYY-MM-DD
  (same normalization rule). "" if not available.

new_or_updated: exactly "New" or "Updated"
  Determine from the PDF's own content (corrigendum/revision → "Updated",
  otherwise "New"). Never from database history.

confidence:
  Integer 0-100 reflecting completeness of the OFFICIAL PDF TEXT you were
  given:
    95-100: PDF gives complete official details (title, dates, and at
            least one of fee/eligibility/vacancy info)
    80-94:  PDF is clear but one non-critical field is missing
    60-79:  PDF has useful info but multiple important details missing
    below 60: PDF text is sparse or ambiguous

raw_explanation:
  Short note: what the PDF confirmed or corrected versus the preliminary
  item, and what remains missing.

==================================================
BLOG GENERATION — markdown_body
==================================================

Audience: Indian government job/exam candidates, including Tier-2/Tier-3
readers. Simple English, short sentences, active voice, no jargon, no fake
urgency ("apply now before it's too late", "golden opportunity",
"guaranteed job"), no keyword stuffing, no AI-sounding language.

Every factual statement must be supported by the PDF text (or, absent that,
the preliminary item). Omit a section entirely rather than writing "Not
Available". A shorter accurate article beats a longer speculative one.

Pure Markdown only — no HTML, no code fences, no JSON inside markdown_body.

Suggested sections, include only when supported by the PDF text:
# SEO Title / short intro / ## Important Dates (table) / ## Vacancy
Details / ## Eligibility Criteria / ## Age Limit / ## Application Fee /
## Selection Process / ## Salary / Pay Scale / ## How to Apply /
## Required Documents / ## Important Links (only the exact supplied
pdf_url or links explicitly present in the PDF text — never invented) /
## FAQs (only from facts explicitly available) / ## Final Note (no new
facts).

==================================================
OUTPUT CONTRACT
==================================================

Return ONLY valid JSON. No markdown, no code fences, no prose outside JSON.

{
  "title": "",
  "original_title": "",
  "summary": "",
  "source_url": "",
  "pdf_url": null,
  "department": "",
  "body": "",
  "category": "",
  "notification_type": "",
  "notification_date": "",
  "application_last_date": "",
  "new_or_updated": "New",
  "confidence": 0,
  "raw_explanation": "",
  "markdown_body": ""
}

==================================================
FINAL VALIDATION (silent, before responding)
==================================================

1. Output is exactly one JSON object, nothing outside it.
2. source_url and pdf_url are unchanged from the preliminary item.
3. category is exactly one allowed value.
4. Dates are YYYY-MM-DD or "" — never guessed, never swapped.
5. No fact anywhere is unsupported by the PDF text (or, absent that, the
   preliminary item).
6. markdown_body is pure Markdown, no HTML, no fabricated links, no fake
   urgency, omits unsupported sections rather than padding them.

RETURN ONLY THE JSON OBJECT.
`;
}

