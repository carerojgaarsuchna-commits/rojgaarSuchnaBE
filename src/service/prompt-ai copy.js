"use strict";

// ═════════════════════════════════════════════════════════════════════════════
// Rojgaar Suchna — LLM Prompt Builders
//
// Three-stage pipeline:
//   LLM #1  buildRelevancePrompt        → { relevant, reason }
//   LLM #2  buildPdfFinderPrompt        → { found, documents[], reason }
//   LLM #3  buildFinalNotificationPrompt → final DB-compatible notification + blog
//
// Contract: DB schema is fixed. Field names, field order, and allowed enum
// values below must not change without a corresponding schema migration.
// ═════════════════════════════════════════════════════════════════════════════

/**
 * LLM #1 — Relevance Detection
 *
 * @param {Object} payload
 * @param {string} payload.watch_uuid
 * @param {string} payload.watch_title
 * @param {string} payload.watch_url
 * @param {string} payload.change_datetime
 * @param {string} [payload.diff_added]
 * @param {string} [payload.diff]
 * @returns {string} prompt text
 */
export function buildRelevancePrompt(payload) {
    const { watch_uuid, watch_title, watch_url, change_datetime, diff_added, diff } =
        payload || {};

    if (!watch_uuid || !watch_title || !watch_url || !change_datetime) {
        throw new Error(
            "buildRelevancePrompt: watch_uuid, watch_title, watch_url, and change_datetime are required"
        );
    }

    const primaryChange =
        typeof diff_added === "string" && diff_added.trim()
            ? diff_added
            : typeof diff === "string"
                ? diff
                : "";

    return `
You are the Relevance Detection Engine for "Rojgaar Suchna".

Your ONLY responsibility is to determine whether the detected website change
contains meaningful candidate-related information that should continue through
the processing pipeline.

You are NOT responsible for:
- extracting notification fields
- detecting duplicates
- querying or reasoning about the database
- finding PDF URLs
- downloading documents
- writing a blog
- generating SEO content
- inventing missing information

==================================================
SOURCE CONTEXT
==================================================

Watch UUID:
${watch_uuid}

Website Name:
${watch_title}

Website URL:
${watch_url}

Detected At:
${change_datetime}

==================================================
CHANGE CONTENT
==================================================

${primaryChange}

==================================================
SOURCE RULES
==================================================

1. Prefer diff_added as the source of the newly appeared content.
2. If diff_added is empty, use diff.
3. Do not treat removed-only content as a new notification.
4. Do not infer information that is not present.
5. Judge only the actual content of the supplied change.
6. Ignore HTML/CSS/JavaScript formatting noise.

==================================================
RELEVANT CONTENT
==================================================

Return relevant=true when the change contains meaningful information related
to candidates, recruitment, examinations, admissions, results, or government
notifications.

Examples include:

- Job vacancy
- Recruitment
- Recruitment advertisement
- Employment notification
- Result
- Merit list
- Cut-off
- Admit Card
- Call Letter
- Answer Key
- Admission
- Counselling
- Syllabus
- Exam Schedule
- Interview Schedule
- Document Verification
- Medical Examination
- PET
- CBT
- Shortlist
- Application Status
- City Intimation
- Corrigendum
- Scholarship
- Candidate-related Notice
- Other genuine government candidate notification

==================================================
IRRELEVANT CONTENT
==================================================

Return relevant=false when the change is only:

- Visitor counter
- IP address
- Server information
- Captcha
- Accessibility text
- Footer
- Copyright
- CSS
- JavaScript
- Logo
- Banner
- Image
- Menu
- Breadcrumb
- Contact information
- Social links
- Formatting changes
- Whitespace changes
- Table reordering
- Unchanged duplicate content
- Commercial advertisements
- Generic "Download", "View", "Login", "Click Here" buttons
- Generic PDF links without meaningful notification context
- Other technical or website noise

A PDF or Download link by itself is NOT evidence of relevance.

==================================================
IMPORTANT DECISION RULE
==================================================

Be conservative.

If the content does not provide enough evidence that a meaningful
candidate-related notification has changed, return relevant=false.

Do not guess.

==================================================
OUTPUT CONTRACT
==================================================

Return ONLY valid JSON.

The response MUST have exactly these fields:

{
  "relevant": true,
  "reason": "Short factual explanation."
}

OR:

{
  "relevant": false,
  "reason": "Short factual explanation."
}

Rules:

- relevant must be boolean.
- reason must be concise.
- Do not return additional fields.
- Do not return markdown.
- Do not return code fences.
- Do not return prose outside JSON.
`;
}

/**
 * LLM #2 — Official Document / PDF Finder
 *
 * @param {Object} payload
 * @param {string} payload.watch_title
 * @param {string} payload.watch_url
 * @param {string} payload.relevant_change
 * @param {string} payload.snapshot
 * @returns {string} prompt text
 */
export function buildPdfFinderPrompt(payload) {
    const { watch_title, watch_url, relevant_change, snapshot } = payload || {};

    if (!watch_title || !watch_url) {
        throw new Error("buildPdfFinderPrompt: watch_title and watch_url are required");
    }

    return `
You are the Official Document Identification Engine for "Rojgaar Suchna".

Your ONLY responsibility is to identify the official document or PDF associated
with the candidate-related notification from the supplied website snapshot.

You are NOT responsible for:
- deciding relevance
- detecting duplicates
- querying the database
- extracting the complete notification
- writing a blog
- creating SEO content
- inventing URLs
- downloading the document

==================================================
SOURCE CONTEXT
==================================================

Website Name:
${watch_title}

Website URL:
${watch_url}

==================================================
RELEVANT CHANGE
==================================================

${relevant_change || ""}

==================================================
WEBSITE SNAPSHOT
==================================================

${snapshot || ""}

==================================================
OBJECTIVE
==================================================

Find the official document associated with the notification represented by
the relevant change.

Look for:

- PDF files
- Official recruitment advertisements
- Notification documents
- Result documents
- Admit card documents
- Answer key documents
- Corrigendum documents
- Official notices
- Other candidate-related attachments

==================================================
DOCUMENT IDENTIFICATION RULES
==================================================

1. The document must be associated with the notification being processed.
2. Do not simply return the first PDF found on the page.
3. Do not return unrelated documents from headers, menus, archives,
   advertisements, or other sections.
4. Prefer the document located immediately with or clearly associated with
   the changed notification.
5. If multiple documents belong to the same notification, return all relevant
   documents.
6. Never invent a filename.
7. Never invent a URL.
8. Never modify an observed filename.
9. Preserve the exact spelling, capitalization and path when possible.

==================================================
URL RULES
==================================================

If a complete HTTPS document URL is explicitly visible:

Return:

"reference_type": "url"

and use the exact URL.

If only a filename is visible:

Example:

14082026-864_0001.pdf

Return:

"reference_type": "filename"

and preserve the exact filename.

If a relative path is visible:

Example:

/uploads/notification/14082026.pdf

Return:

"reference_type": "path"

and preserve the exact path.

Do NOT convert filenames into URLs.

Do NOT guess the website's PDF directory.

Do NOT append .pdf.

Do NOT construct URLs.

==================================================
FILE EXTENSIONS
==================================================

Government documents may use:

.pdf
.doc
.docx
.xls
.xlsx
.aspx
.php
or a path without a conventional extension.

Treat a clearly identified official attachment as a document regardless of
extension.

==================================================
NO DOCUMENT FOUND
==================================================

If the snapshot does not provide reliable evidence of an associated document,
return found=false.

Do NOT guess.

==================================================
OUTPUT CONTRACT
==================================================

Return ONLY valid JSON.

If documents are found:

{
  "found": true,
  "documents": [
    {
      "reference": "EXACT_VISIBLE_FILENAME_OR_URL",
      "reference_type": "url"
    }
  ],
  "reason": "Short factual explanation."
}

Allowed reference_type values:

- "url"
- "filename"
- "path"

If no document is found:

{
  "found": false,
  "documents": [],
  "reason": "No reliable associated official document was found."
}

Rules:

- found must be boolean.
- documents must always be an array.
- reference must contain only information explicitly visible in the input.
- Do not add fields.
- Do not return markdown.
- Do not return code fences.
- Do not return prose outside JSON.
`;
}

// ─────────────────────────────────────────────────────────────────────────────
// LLM #3 — FINAL NOTIFICATION + BLOG GENERATOR
// ─────────────────────────────────────────────────────────────────────────────
//
// PURPOSE
// ───────
// LLM #3 is the FINAL content authority.
//
// LLM #1 decides relevance.
// LLM #2 finds/references a possible official document.
// Backend attempts document fetching/extraction.
// LLM #3 produces the final DB-compatible notification + blog.
//
// IMPORTANT:
// - DB schema MUST NOT change.
// - LLM #3 must never perform duplicate detection.
// - LLM #3 must never fetch a PDF.
// - LLM #3 must never invent information.
// - When PDF text exists, PDF is authoritative.
// - When PDF text does not exist, relevant_change is the factual source.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * LLM #3 — Final Notification + Blog Generator
 *
 * @param {Object} payload
 * @param {string} payload.watch_uuid
 * @param {string} payload.watch_title
 * @param {string} payload.watch_url
 * @param {string} payload.change_datetime
 * @param {Object} payload.relevance_result   - output of buildRelevancePrompt call
 * @param {string} payload.relevant_change
 * @param {Object} [payload.pdf_result]        - output of buildPdfFinderPrompt call
 * @param {string} [payload.pdf_url]
 * @param {string} [payload.pdf_text]
 * @param {Object} [payload.pass1_item]
 * @returns {string} prompt text
 */
export function buildFinalNotificationPrompt(payload) {
    const {
        watch_uuid,
        watch_title,
        watch_url,
        change_datetime,

        relevance_result,
        relevant_change,

        pdf_result = null,
        pdf_url = null,
        pdf_text = null,

        pass1_item = null,
    } = payload || {};

    if (!watch_uuid || !watch_title || !watch_url || !change_datetime) {
        throw new Error(
            "buildFinalNotificationPrompt: watch_uuid, watch_title, watch_url, and change_datetime are required"
        );
    }

    // Determine the actual source mode BEFORE constructing the prompt.
    //
    // PDF TEXT is what makes the PDF authoritative.
    // A URL alone does NOT mean the PDF was successfully read.

    const hasPdfText = typeof pdf_text === "string" && pdf_text.trim().length > 0;
    const hasPdfUrl = typeof pdf_url === "string" && pdf_url.trim().length > 0;

    let sourceMode;

    if (hasPdfText) {
        sourceMode = "PDF_AVAILABLE";
    } else if (hasPdfUrl) {
        sourceMode = "PDF_URL_ONLY";
    } else {
        sourceMode = "NO_PDF";
    }

    const sourceModeInstructions = {
        PDF_AVAILABLE: `
SOURCE MODE: PDF_AVAILABLE

The backend successfully supplied official document text.

AUTHORITATIVE SOURCE:
OFFICIAL DOCUMENT TEXT

SOURCE PRIORITY:

1. Official PDF/document text
2. Relevant website change
3. LLM #2 document finder result
4. Website metadata

The official document is the single source of truth for notification facts.

If the website change conflicts with the official document:
→ prefer the official document.

The PDF URL is only the document reference.
The PDF TEXT is the actual authoritative content.

You may refine/reconstruct the notification fields from the official
document text.

You may generate the full article from the official document.

Do NOT rely on Pass 1 values when the PDF provides a different value.
Pass 1 is only preliminary context.

`,

        PDF_URL_ONLY: `
SOURCE MODE: PDF_URL_ONLY

A document/PDF URL was found, but the backend did NOT provide readable
document text.

CRITICAL:

The PDF has NOT been read by you.

The PDF URL is ONLY a document reference.

DO NOT infer the contents of the document from:

- filename
- URL
- path
- query parameters
- document extension
- organization name
- common government recruitment patterns

AUTHORITATIVE FACTUAL SOURCE:

1. Relevant website change
2. LLM #1 relevance result for classification/context
3. PDF URL ONLY as a reference

The relevant website change is the ONLY available factual content.

If a fact is not explicitly present in relevant_change:

→ leave the corresponding field empty.

Do NOT claim that the PDF says something.

Do NOT write "according to the official PDF".

Do NOT create detailed vacancy, eligibility, fee, salary, selection, or
application information merely because a PDF URL exists.

Preserve the supplied PDF URL exactly in pdf_url.

`,

        NO_PDF: `
SOURCE MODE: NO_PDF

No PDF/document URL was found and no document text is available.

AUTHORITATIVE FACTUAL SOURCE:

1. Relevant website change
2. LLM #1 relevance result for classification/context
3. Website metadata only for source identification

The relevant website change is the ONLY available factual content.

Do NOT assume that a notification contains information merely because
the source website is a government recruitment website.

If a fact is not explicitly present in relevant_change:

→ leave the corresponding field empty.

A short accurate notification is better than a detailed notification
containing unsupported information.

pdf_url MUST be null.
`,
    }[sourceMode];

    return `
You are the Final Notification Processing Engine for "Rojgaar Suchna".

Your responsibility is to produce the FINAL database-compatible notification
object and a human-friendly SEO article.

This is the FINAL content-generation stage.

The output of this stage will be persisted by the backend.

You MUST follow the exact output contract at the end of this prompt.

==================================================
PIPELINE POSITION
==================================================

The processing pipeline is:

Changedetection
    ↓
LLM #1 — Relevance
    ↓
LLM #2 — Document Finder
    ↓
Backend — Document Fetch / Text Extraction
    ↓
LLM #3 — Final Notification + Blog
    ↓
MongoDB

LLM #3 is NOT responsible for:

- relevance detection
- PDF discovery
- PDF downloading
- duplicate detection
- database history lookup
- database writes
- URL construction

==================================================
CURRENT SOURCE MODE
==================================================

${sourceMode}

${sourceModeInstructions}

==================================================
SOURCE CONTEXT
==================================================

Watch UUID:
${watch_uuid}

Website Name:
${watch_title}

Website URL:
${watch_url}

Detected At:
${change_datetime}

==================================================
LLM #1 — RELEVANCE RESULT
==================================================

${JSON.stringify(relevance_result, null, 2)}

IMPORTANT:

This result is classification/context.

Do not blindly copy facts from it if stronger source material is
available.

==================================================
RELEVANT WEBSITE CHANGE
==================================================

${relevant_change || ""}

IMPORTANT:

This is the website content/change identified as relevant by the
previous processing stage.

Use it as factual source only according to the SOURCE MODE rules above.

==================================================
LLM #2 — DOCUMENT FINDER RESULT
==================================================

${JSON.stringify(pdf_result, null, 2)}

IMPORTANT:

The document finder result identifies a possible document.

It does NOT automatically provide the document's contents.

Never treat a PDF filename or URL as proof of facts inside the document.

==================================================
PDF URL
==================================================

${pdf_url || "null"}

==================================================
OFFICIAL DOCUMENT TEXT
==================================================

${hasPdfText ? pdf_text : "NOT AVAILABLE"}

==================================================
PASS 1 ITEM
==================================================

${JSON.stringify(pass1_item, null, 2)}

IMPORTANT:

Pass 1 data is preliminary.

When authoritative PDF text is available:

→ independently verify/refine the fields from the PDF.

When PDF text is unavailable:

→ do NOT assume Pass 1 contains facts that are not supported by the
relevant website change.

==================================================
GLOBAL FACTUAL RULES
==================================================

These rules apply in ALL source modes.

1. NEVER fabricate facts.

2. NEVER guess missing information.

3. NEVER use general knowledge to complete the notification.

4. NEVER assume standard government recruitment rules.

5. NEVER infer facts from an organization's historical behavior.

6. NEVER infer facts from a PDF filename.

7. NEVER infer facts from a PDF URL.

8. NEVER construct URLs.

9. NEVER create application links that are not explicitly supplied.

10. NEVER invent vacancy numbers.

11. NEVER invent post names.

12. NEVER invent dates.

13. NEVER invent application deadlines.

14. NEVER invent application fees.

15. NEVER invent eligibility criteria.

16. NEVER invent qualifications.

17. NEVER invent age limits.

18. NEVER invent age relaxations.

19. NEVER invent salary/pay scale.

20. NEVER invent selection stages.

21. NEVER invent examination dates.

22. NEVER invent application procedures.

23. NEVER invent required documents.

24. NEVER invent result information.

25. NEVER invent admit-card information.

26. NEVER invent answer-key information.

27. NEVER invent scholarship/tender details.

If information is unavailable:

Use the schema-compatible empty value.

==================================================
SOURCE CONFLICT RULE
==================================================

When multiple sources contain conflicting information:

IF OFFICIAL PDF TEXT EXISTS:

    PDF TEXT wins.

ELSE:

    Relevant website change wins.

LLM #1 and LLM #2 are supporting/context sources only.

Never resolve a conflict by guessing.

==================================================
NOTIFICATION TITLE
==================================================

title:

Create a human-friendly SEO title.

Prefer approximately 40-80 characters when possible.

Keep the primary search keyword near the beginning.

Use only information supported by the authoritative source.

Do not add:

- guessed vacancy numbers
- guessed dates
- unsupported claims
- fake urgency

Examples of style:

"RRB Technician Recruitment 2026"
"SSC CGL 2026 Exam Date Released"
"UPSC Civil Services 2026 Result"
"Railway ALP Admit Card 2026 Released"

These are style examples only.

Do not copy facts from the examples.

==================================================
ORIGINAL TITLE
==================================================

original_title:

Use the exact official notification/document title when available.

When PDF text exists:

→ use the official title from the PDF.

When PDF text does not exist:

→ use the exact title only if explicitly available in relevant_change.

Do NOT rewrite original_title.

If an exact official title cannot be established:

""

==================================================
SUMMARY
==================================================

summary:

Write 2-3 short sentences.

Explain:

- what the notification/change is about
- what candidates should know
- what action is explicitly supported by the source

Do not add unsupported details.

If very little information is available,
write a short accurate summary rather than inventing detail.

==================================================
SOURCE URL
==================================================

source_url:

MUST be exactly:

${watch_url}

Never modify it.

Never replace it with pdf_url.

==================================================
PDF URL
==================================================

pdf_url:

If SOURCE MODE is PDF_AVAILABLE:

    Use the supplied pdf_url exactly.

If SOURCE MODE is PDF_URL_ONLY:

    Use the supplied pdf_url exactly.

If SOURCE MODE is NO_PDF:

    Use null.

NEVER construct or repair a URL.

NEVER replace a missing URL with watch_url.

==================================================
PDF BACKEND FETCH FIELD
==================================================

pdf_needs_backend_fetch:

This field reflects whether a document reference exists.

If pdf_url is non-null:

    true

If pdf_url is null:

    false

Do not set it based on whether PDF text was successfully extracted.

Do not change this field merely because the backend already attempted
the fetch.

==================================================
DEPARTMENT
==================================================

department:

Government ministry, department, commission, board, authority, or
organization only when supported by the authoritative source.

Do not infer a department from general knowledge.

If unavailable:

""

==================================================
BODY
==================================================

body:

Use the official recruiting/exam/admitting organization name.

When PDF text exists:

→ extract from the PDF.

When PDF text does not exist:

→ use only information explicitly present in relevant_change.

If unavailable:

""

==================================================
CATEGORY
==================================================

category MUST be exactly ONE of:

"Job"
"Result"
"Admit Card"
"Answer Key"
"Syllabus"
"Admission"
"Notice"
"Scholarship"
"Tender"

Determine the category from the actual notification content.

Do NOT select a category simply because the website is known for that
type of content.

Examples:

Recruitment advertisement
→ Job

Result / merit list
→ Result

Call letter / admit card
→ Admit Card

Answer key
→ Answer Key

Syllabus
→ Syllabus

Admission notice
→ Admission

Scholarship announcement
→ Scholarship

Tender
→ Tender

Corrigendum or general official announcement
→ Notice

==================================================
NOTIFICATION TYPE
==================================================

notification_type:

Use a specific type supported by the source.

Examples:

Recruitment Advertisement
Corrigendum
Result
Admit Card
Answer Key
Exam Schedule
Shortlist
Interview Schedule
Document Verification
Medical Examination
Application Status
City Intimation
Admission Notice
Scholarship Notice
Tender Notice
Notice

Do not invent a more specific type than the source supports.

==================================================
NOTIFICATION DATE
==================================================

notification_date:

This means the official publication/notification date.

It does NOT mean:

- application deadline
- exam date
- admit-card date
- detected date

When PDF text exists:

→ use the official publication/notification date from the PDF.

When PDF text does not exist:

→ use only an explicitly stated publication/notification date from
relevant_change.

If no official publication date is available:

""

IMPORTANT:

Do NOT use change_datetime as notification_date.

==================================================
APPLICATION LAST DATE
==================================================

application_last_date:

Use the final application/submission deadline only.

Format:

YYYY-MM-DD

If unavailable:

""

Do not confuse:

- notification date
- application start date
- exam date
- result date
- document verification date

with application_last_date.

==================================================
NEW OR UPDATED
==================================================

new_or_updated MUST be exactly:

"New"

or

"Updated"

Use the content itself to determine this.

NEW:

- newly published notification
- newly released result
- newly released admit card
- newly released answer key
- newly announced schedule
- newly published recruitment

UPDATED:

- corrigendum
- revised notification
- revised result
- revised schedule
- extension
- modification
- correction
- updated vacancy information
- revised eligibility
- revised application deadline

Do NOT use database history.

Do NOT perform duplicate detection to determine this field.

==================================================
CONFIDENCE
==================================================

confidence:

Integer from 0 to 100.

Confidence represents the quality and completeness of the available
source material.

Suggested interpretation:

90-100:
Strong official source with clear and complete information.

75-89:
Strong source but some non-critical information is missing.

60-74:
Useful official information but important details are missing.

40-59:
Limited or partial information.

0-39:
Very incomplete or ambiguous information.

IMPORTANT:

Confidence is NOT certainty that the notification is real.

Confidence is NOT duplicate probability.

Confidence is NOT model confidence.

When PDF text is unavailable, do not give high confidence simply because
a PDF URL exists.

==================================================
RAW EXPLANATION
==================================================

raw_explanation:

Write a short internal explanation.

Mention:

- what source was authoritative
- important extraction decisions
- missing/uncertain information
- whether PDF content was available

Examples:

"Finalized from official PDF text. Publication date and application
deadline were extracted from the document."

OR:

"No PDF content was available. Final fields were limited to information
explicitly present in the relevant website change."

OR:

"PDF URL was identified but document text could not be extracted.
Notification facts were limited to the relevant website change."

Do not put internal pipeline details into markdown_body.

==================================================
DUPLICATE FIELD
==================================================

is_duplicate:

LLM #3 MUST NOT perform duplicate detection.

Always return:

false

Duplicate detection is handled outside this prompt by the application
logic.

Do not inspect database history.

Do not infer duplicates from Pass 1.

Do not compare against previous notifications.

==================================================
BLOG GENERATION
==================================================

Generate a complete human-friendly SEO article in:

markdown_body

The article must contain ONLY information supported by the authoritative
source for the current SOURCE MODE.

==================================================
BLOG SOURCE RULE
==================================================

IF PDF_AVAILABLE:

    The official PDF is the factual source.

IF PDF_URL_ONLY:

    The relevant website change is the factual source.

    The PDF URL is only a document reference.

IF NO_PDF:

    The relevant website change is the factual source.

==================================================
BLOG STYLE
==================================================

Audience:

Indian government job and exam candidates, including Tier-2 and Tier-3
city readers.

Use:

- Simple English
- Clear language
- Short sentences
- Active voice
- Candidate-focused writing
- Natural tone
- Helpful explanations
- Practical wording

Avoid:

- unnecessary jargon
- exaggerated claims
- fake urgency
- repetitive statements
- keyword stuffing
- robotic language

Do not write like an AI.

==================================================
BLOG FACTUAL RULE
==================================================

EVERY factual statement in markdown_body must be supported by the
authoritative source.

Never invent:

- vacancies
- post names
- dates
- fees
- eligibility
- age limits
- salary
- selection process
- links
- qualifications
- application procedure
- required documents
- exam dates

If information is unavailable:

OMIT the section.

Do NOT create a section containing:

"Not Available"

unless it is genuinely useful to the reader.

A shorter accurate article is better than a long article containing
unsupported information.

==================================================
PDF URL ONLY BLOG RULE
==================================================

When SOURCE MODE is PDF_URL_ONLY:

You MAY provide the discovered PDF URL under Important Links because
the URL itself is supplied.

But you MUST NOT describe the contents of that PDF.

Do NOT write:

"According to the official PDF..."

Do NOT write:

"The PDF states that..."

Do NOT write:

"The notification contains 500 vacancies..."

unless that fact appears in relevant_change.

==================================================
BLOG STRUCTURE
==================================================

Use only sections supported by the authoritative source.

Recommended structure:

# SEO Title

Short introduction.

## Important Dates

Use only when dates are available.

| Event | Date |
|---|---|

## Vacancy Details

Use only when vacancy information exists.

## Eligibility Criteria

Use only when eligibility information exists.

## Age Limit

Use only when age information exists.

## Application Fee

Use only when fee information exists.

## Selection Process

Use only when selection information exists.

## Salary / Pay Scale

Use only when salary information exists.

## How to Apply

Use only when application instructions exist.

## Required Documents

Use only when documents are explicitly mentioned.

## Important Links

Use only official links explicitly supported by the source.

For PDF_URL_ONLY:

The supplied pdf_url may be included exactly as supplied.

For NO_PDF:

Do not invent a PDF link.

## FAQs

Create FAQs only from facts explicitly available in the source.

Do not create generic questions whose answers require unsupported
information.

## Final Note

Give a short candidate-focused closing.

Do not introduce new facts.

==================================================
SEO RULES
==================================================

The title should naturally contain the primary notification keyword.

Do not keyword-stuff.

Do not repeat the same keyword unnaturally.

Do not make unsupported SEO claims such as:

- "Apply now before it is too late"
- "Golden opportunity"
- "Best government job"
- "100% selection"
- "Guaranteed job"

unless such wording is actually part of an official source and is
necessary — which normally it is not.

==================================================
MARKDOWN RULES
==================================================

markdown_body MUST contain PURE MARKDOWN.

Allowed:

# Heading
## Heading
### Heading
- bullet
1. numbered item
| Column | Column |
|---|---|

Do NOT use HTML.

Do NOT use markdown code fences inside markdown_body.

Do NOT put JSON inside markdown_body.

Do NOT use raw HTML links.

If links are included, use normal Markdown links only when the exact URL
is explicitly supported by the source.

==================================================
IMPORTANT LINKS RULE
==================================================

Never construct URLs.

Never modify URLs.

Never replace a missing official URL with an assumed URL.

Only use:

1. Exact supplied pdf_url
2. Exact official links explicitly present in the authoritative source

==================================================
OUTPUT CONTRACT
==================================================

Return ONLY ONE valid JSON object.

The JSON MUST contain EXACTLY these fields:

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
  "is_duplicate": false,
  "markdown_body": ""
}

==================================================
OUTPUT FIELD ORDER
==================================================

Return fields in exactly this order:

1. title
2. original_title
3. summary
4. source_url
5. department
6. body
7. category
8. notification_type
9. notification_date
10. application_last_date
11. new_or_updated
12. confidence
13. raw_explanation
14. pdf_url
15. pdf_needs_backend_fetch
16. is_duplicate
17. markdown_body

==================================================
FINAL VALIDATION
==================================================

Before responding, silently validate ALL of the following.

SCHEMA:

1. Output is exactly one JSON object.
2. No text exists outside JSON.
3. No additional fields exist.
4. All required fields exist.
5. confidence is an integer from 0 to 100.
6. new_or_updated is exactly "New" or "Updated".
7. is_duplicate is exactly false.

CATEGORY:

8. category is exactly one allowed category.

SOURCE:

9. source_url equals the supplied Website URL exactly.

PDF:

10. If pdf_url is supplied, preserve it exactly.
11. If no pdf_url exists, pdf_url is null.
12. pdf_needs_backend_fetch is true when pdf_url is non-null.
13. pdf_needs_backend_fetch is false when pdf_url is null.
14. Never infer PDF contents from pdf_url.

DATES:

15. Dates use YYYY-MM-DD when exact dates are known.
16. notification_date is the publication/notification date.
17. application_last_date is the application deadline.
18. Never swap these dates.
19. Never guess a missing date.

FACTUAL ACCURACY:

20. Every factual field is supported by the appropriate source.
21. No vacancies were invented.
22. No eligibility was invented.
23. No fee was invented.
24. No salary was invented.
25. No selection process was invented.
26. No URL was invented.
27. No database history was used.
28. No duplicate detection was performed.

BLOG:

29. markdown_body contains pure Markdown.
30. No HTML exists in markdown_body.
31. No unsupported factual statement exists in markdown_body.
32. Sections unsupported by the source are omitted.
33. No AI/internal pipeline terminology appears in the article.
34. No fake urgency or exaggerated claims exist.
35. No fabricated links exist.

SOURCE MODE:

36. If PDF_AVAILABLE:
    PDF text is treated as authoritative.

37. If PDF_URL_ONLY:
    relevant_change is treated as factual source.
    PDF URL is only a reference.

38. If NO_PDF:
    relevant_change is treated as factual source.
    pdf_url is null.

If ANY validation rule fails, fix the output before returning it.

RETURN ONLY THE JSON OBJECT.
`;
}

