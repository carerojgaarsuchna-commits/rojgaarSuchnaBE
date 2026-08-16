import { z } from "zod";
import { callTextLlm, getTextModel } from "./ai-api/aiProvider.js";
import crypto from "crypto";
import axios from "axios";
import { LatestNotification } from "../models/LatestNotification.js";
import { normalizeNotificationCategory } from "../utils/notificationCategory.js";
import { buildSlug, generateUniqueSlug } from "../utils/helper.js";
// import { createAIBlog } from "./latestJobsService.js";
import { updateRawEventStatus } from "../services/pipeline/rawEvent.service.js";
import { PIPELINE_STATUS } from "../constants/pipelineStatus.js";

// ─── Env config ───────────────────────────────────────────────────────────────
const PDF_TIMEOUT_MS = Number(process.env.PDF_TIMEOUT_MS) || 15000;
const PDF_MAX_BYTES = Number(process.env.PDF_MAX_BYTES) || 10 * 1024 * 1024; // 10 MB
const PDF_TEXT_LIMIT = Number(process.env.PDF_TEXT_LIMIT) || 15000;

// ─── Zod schemas for AI output validation ────────────────────────────────────

const Pass1ItemSchema = z.object({
    title: z.string().min(1),
    original_title: z.string().min(1),
    summary: z.string().min(1),
    source_url: z.string().min(1),
    department: z.string().optional().default(""),
    body: z.string().optional().default(""),
    category: z.string().min(1),
    notification_type: z.string().optional().default("Other"),
    notification_date: z.string().optional().default(""),
    new_or_updated: z.enum(["New", "Updated"]).optional().default("New"),
    confidence: z.number().min(0).max(100).optional().default(80),
    raw_explanation: z.string().optional().default(""),
    pdf_url: z.string().nullable().optional(),
    pdf_needs_backend_fetch: z.boolean().optional().default(false),
    is_duplicate: z.boolean().optional().default(false),
});

const Pass1ResponseSchema = z.union([
    // Irrelevant case
    z.object({
        relevant: z.literal(false),
        reason: z.string().optional(),
    }),
    // Relevant case
    z.object({
        relevant: z.literal(true),
        publish: z.boolean().optional(),
        watch_uuid: z.string().optional(),
        items: z.array(Pass1ItemSchema).min(1),
    }),
]);

const Pass2ItemSchema = z.object({
    title: z.string().min(1),
    original_title: z.string().optional(),
    summary: z.string().optional(),
    source_url: z.string().optional(),
    pdf_url: z.string().nullable().optional(),
    department: z.string().optional().default(""),
    body: z.string().optional().default(""),
    category: z.string().optional(),
    notification_type: z.string().optional(),
    notification_date: z.string().optional(),
    new_or_updated: z.enum(["New", "Updated"]).optional(),
    confidence: z.number().min(0).max(100).optional(),
    raw_explanation: z.string().optional(),
    markdown_body: z.string().optional(),
});

// ─── JSON extraction ──────────────────────────────────────────────────────────

/**
 * Extract the outermost JSON object from raw LLM text.
 * Handles: plain JSON, ```json fences, prose-wrapped JSON.
 * Strategy: strip fences → find first { → find matching last } by balance.
 */
export function extractJsonFromText(rawText) {
    if (!rawText || typeof rawText !== "string") return null;

    let text = rawText.trim();

    // Strip markdown code fences: ```json ... ``` or ``` ... ```
    text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();

    // Find first {
    const start = text.indexOf("{");
    if (start === -1) return null;

    // Find matching last } by tracking brace depth
    let depth = 0;
    let end = -1;
    for (let i = start; i < text.length; i++) {
        if (text[i] === "{") depth++;
        else if (text[i] === "}") {
            depth--;
            if (depth === 0) { end = i; break; }
        }
    }

    if (end === -1) return null;
    return text.slice(start, end + 1);
}

// ─── HTML cleaning ────────────────────────────────────────────────────────────

/**
 * Clean full page HTML snapshot for AI processing.
 * Removes scripts, styles, nav, footer, SVGs and converts relative links to absolute.
 */
export function cleanHtmlSnapshot(rawHtml, baseUrl = "") {
    if (!rawHtml || typeof rawHtml !== "string") return "";

    let html = rawHtml;

    // Remove noise tags
    html = html.replace(/<(script|style|nav|footer|header|svg)[\s\S]*?<\/\1>/gi, "");

    // Remove inline base64 images
    html = html.replace(/src=["']data:image\/[^"']+["']/gi, 'src=""');

    // Convert relative hrefs to absolute
    if (baseUrl) {
        html = html.replace(/href=["']([^"']+)["']/gi, (match, hrefValue) => {
            try {
                if (
                    hrefValue.startsWith("javascript:") ||
                    hrefValue.startsWith("mailto:") ||
                    hrefValue.startsWith("#")
                ) return match;
                return `href="${new URL(hrefValue, baseUrl).href}"`;
            } catch {
                return match;
            }
        });
    }

    return html.replace(/\n\s*\n/g, "\n").trim();
}

// ─── Event hash ───────────────────────────────────────────────────────────────

/**
 * Generate SHA-256 hash for incoming webhook event (L1 deduplication key).
 */
export function buildEventHash(watchUuid, changeDatetime, diffAdded = "") {
    const rawString = `${watchUuid || ""}|${changeDatetime || ""}|${diffAdded || ""}`;
    return crypto.createHash("sha256").update(rawString).digest("hex");
}

// ─── Secret stripping ─────────────────────────────────────────────────────────

/**
 * Remove secret key from payload before saving to DB or BullMQ.
 */
export function stripSecretFromPayload(payload) {
    if (!payload || typeof payload !== "object") return {};
    const { secret, ...safePayload } = payload;
    return safePayload;
}

// ─── Pass 1 prompt ────────────────────────────────────────────────────────────

function buildPrompt(payload, recentDocs = []) {
    const {
        watch_uuid,
        watch_title,
        watch_url,
        change_datetime,
        diff,
        diff_added,
        diff_removed,
    } = payload;

    const recentContext = recentDocs.length > 0
        ? `==================================================
RECENT NOTIFICATIONS FROM THIS SOURCE (last ${recentDocs.length})
Use these to detect near-duplicates and determine new_or_updated status.
==================================================
${recentDocs.map(d =>
            `- title: "${d.title}" | date: ${d.notification_date || "unknown"} | category: ${d.category}`
        ).join("\n")}

`
        : "";

    return `
    You are the content extraction engine for "Rojgaar Suchna", a platform that monitors official Indian government websites for recruitment, examination, admission, and other candidate-related notifications.

    Your job is to analyze a detected website change and determine whether it contains one or more genuine, publishable recruitment-related notifications.

    ==================================================
    CONTEXT
    ==================================================

    Watch UUID:
    ${watch_uuid}

    Website Name:
    ${watch_title}

    Website URL:
    ${watch_url}

    Detected At:
    ${change_datetime}

    PRIMARY INPUT (Extract notifications ONLY from this):
    ${diff_added}

    REFERENCE INPUT (Never extract new notifications from this):
    ${diff_removed}

    FALLBACK INPUT (Use ONLY when PRIMARY INPUT is empty):
    ${diff}

    ${recentContext}==================================================
    GENERAL RULES
    ==================================================

    Source Priority (STRICT)

    1. Extract notifications ONLY from diff_added.
    2. If diff_added is empty, extract from diff.
    3. Never create a notification solely from diff_removed.
    4. diff_removed exists ONLY to determine whether a notification is Updated.
    5. If a notification appears only in diff_removed, ignore it completely.
    6. Never combine information from diff_added and diff_removed into a new notification.
    7. Never invent, complete, or assume missing information.
    8. Website Name and Website URL are authoritative.
    9. Strip HTML, CSS, JavaScript, visitor counters and formatting artifacts before analysis.
    10. Return ONLY valid JSON.
    11. Do NOT return markdown.
    12. Do NOT explain anything outside the JSON.

    ==================================================
    CHANGE INTERPRETATION RULES
    ==================================================

    Interpret the inputs exactly as follows:

    diff_added
    -------------
    Contains content that has appeared on the website.
    Only this content may produce NEW notifications.

    diff_removed
    -------------
    Contains content that disappeared from the website.
    This content MUST NOT produce new notifications.

    A notification found ONLY in diff_removed means it was removed from the page.
    Ignore it unless it clearly represents an updated version of the SAME notification found in diff_added.

    diff
    -------------
    Contains both added and removed content.
    Use it ONLY when diff_added is empty.
    Never extract from diff if diff_added contains recruitment information.

    ==================================================
    STEP 1 — RELEVANCE CHECK
    ==================================================

    Determine whether the content contains one or more genuine recruitment-related notifications.

    Relevant examples include:

    - Job / Job Vacancy / Recruitment Advertisement
    - Result / Merit List / Cut Off
    - Admit Card / Call Letter
    - Answer Key
    - Admission / Counselling
    - Syllabus / Exam Schedule
    - Interview Schedule / Document Verification / Medical Examination
    - PET / CBT / Shortlist / Application Status / City Intimation
    - Corrigendum / Scholarship / Tender

    Ignore completely if the change is only:

    - Visitor counter / IP address / Server name / Captcha
    - Accessibility text / Footer / Copyright / CSS / JavaScript
    - HTML fragments / Logo / Banner / Image / Menu / Breadcrumb
    - Contact information / Social links / Formatting changes
    - Whitespace changes / Table reordering / Duplicate unchanged content
    - Commercial advertisements
    - Generic buttons such as: Click Here, Download, Login, View, PDF
    unless surrounding text clearly identifies an actual recruitment notification.

    If the provided text is obviously truncated or incomplete and reliable extraction is impossible, never guess the missing information.

    If nothing publishable exists, return ONLY:

    {
    "relevant": false,
    "reason": "Short explanation."
    }

    ==================================================
    STEP 2 — EXTRACTION
    ==================================================

    If one or more publishable notifications exist, return:

    {
    "relevant": true,
    "publish": true,
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
        "new_or_updated": "",
        "confidence": 0,
        "raw_explanation": "",
        "pdf_url": null,
        "pdf_needs_backend_fetch": false,
        "is_duplicate": false
        }
    ]
    }

    ==================================================
    PDF FIELDS — IMPORTANT
    ==================================================

    pdf_url:
    - If the notification has a direct link to an official PDF document visible in diff_added, set this to the full absolute URL.
    - If the link is relative (e.g. /pdf/notice.pdf), resolve it against the Website URL above to form the full URL.
    - If no PDF link is visible, set to null.
    - Do NOT invent PDF URLs. Only use links explicitly visible in the content.

    pdf_needs_backend_fetch:
    - Set to true ONLY when pdf_url is non-null AND the backend should download and extract the PDF text for deeper analysis.
    - If pdf_url is null, set to false.
    - If the PDF content is already fully captured in the diff text, set to false.

    is_duplicate:
    - Set to true if this notification appears to already exist in the RECENT NOTIFICATIONS list above (same title, date, and category).
    - Set to false otherwise.

    ==================================================
    MULTIPLE NOTIFICATIONS
    ==================================================

    Return ONE object inside "items" for EACH distinct notification.

    Do NOT merge unrelated notifications.
    Language variants of the SAME notification (English, Hindi, Marathi, Tamil) = ONE notification.
    Never create an item for content that appears only in diff_removed.

    ==================================================
    FIELD RULES
    ==================================================
    title — Human-friendly SEO title (40–80 chars, Title Case)
    original_title — Exact official title, no rewording
    summary — 2–3 sentences: what changed + what candidates should do next
    source_url — Exactly the Website URL provided above
    body — Recruiting organization name (1-2 sentences)
    department — Ministry/department (infer only when obvious)
    category — EXACTLY one of: Job, Result, Admit Card, Answer Key, Syllabus, Admission, Notice, Scholarship, Tender
    notification_type — e.g. Recruitment Advertisement, Result, Answer Key, Corrigendum, etc.
    notification_date — YYYY-MM-DD (use Detected At if no explicit date; note this in raw_explanation)
    new_or_updated — "New" or "Updated"
    confidence — 0-100 (95+ = complete official info; below 60 = needs review)
    raw_explanation — Brief internal note on any inference or uncertainty

    ==================================================
    FINAL RULES
    ==================================================

    - Never fabricate facts, dates, or notification numbers.
    - Category must be exactly one of the allowed values above.
    - Return ONLY valid JSON. No prose. No markdown code fences.
    - A notification MUST originate from diff_added.
    `;
}

// ─── Pass 2 prompt ────────────────────────────────────────────────────────────

function buildPass2Prompt(pass1Item, pdfText) {
    return `
You are the content refinement engine and blog writer for "Rojgaar Suchna".
We have already extracted preliminary notification data from a website change (Pass 1).
Now, we have extracted the FULL TEXT of the official PDF document related to this notification.

==================================================
PASS 1 EXTRACTED ITEM (Reference only — do NOT blindly copy these values)
==================================================
${JSON.stringify(pass1Item, null, 2)}

==================================================
OFFICIAL PDF CONTENT (AUTHORITATIVE — single source of truth)
==================================================
${pdfText.slice(0, PDF_TEXT_LIMIT)}

==================================================
INSTRUCTIONS
==================================================
1. Treat the OFFICIAL PDF CONTENT as the single source of truth.
2. Refine ALL fields (title, summary, department, body, category, notification_type, notification_date) from the official PDF text.
3. Do NOT hardcode or blindly copy category/notification_type from Pass 1. Re-evaluate them independently from the PDF content.
4. Keep the category strictly one of: Job, Result, Admit Card, Answer Key, Syllabus, Admission, Notice, Scholarship, Tender.
5. Also generate a complete human-friendly SEO-optimized blog article in the "markdown_body" field.
6. The markdown_body MUST be in PURE MARKDOWN format ONLY. Do NOT use any HTML tags.
7. Return ONLY valid JSON in the exact format below. No prose, no markdown code fences.

==================================================
JSON OUTPUT FORMAT
==================================================
{
    "title": "Refined SEO Title Case Title from PDF",
    "original_title": "${pass1Item.original_title || ""}",
    "summary": "Updated 2-3 sentence summary from PDF...",
    "source_url": "${pass1Item.source_url || ""}",
    "pdf_url": "${pass1Item.pdf_url || ""}",
    "department": "Ministry/Department Name as stated in PDF",
    "body": "Recruiting organization name (1-2 sentences from PDF)",
    "category": "",
    "notification_type": "",
    "notification_date": "YYYY-MM-DD",
    "new_or_updated": "${pass1Item.new_or_updated || "New"}",
    "confidence": 95,
    "raw_explanation": "Refined using Pass 2 PDF. Category determined from PDF content.",
    "markdown_body": "Exact Output Structure (copy this format): # SEO Title (55 chars max, keyword front-loaded) Meta Description (155 chars max, keyword + CTA) ### Short Introduction (100 words max) ### 📅 Important Dates | Event | Date | |-------|------| | ... | ... | ### 💼 Vacancy Details - List posts, expected vacancies - Education table ### 👤 Eligibility Criteria Numbered requirements + quick checklist ### 📊 Age Limit Table | Post | Age | Birth Range | ### 💰 Application Fee Details + payment methods ### 🧭 Selection Process 3 stages with bullets ### 💵 Salary & Benefits Year-wise breakdown ### 📝 How to Apply (7 Steps) 1. Visit joinindianarmy.nic.in ... ### 📂 Required Documents Bullet list with file specs ### ✅ Why Apply Now? 5 bullet benefits ### 🧠 Preparation Tips 6 numbered tips ### ❓ FAQs (6 Questions) Q1: [Question] A: [Answer] ### 🎯 Final Call-to-Action Urgent CTA + official links"
}

CRITICAL RULES FOR markdown_body:
- Use ONLY Markdown syntax. NEVER use HTML tags.
- Tables MUST use Markdown format: | Column | Column |
- Lists MUST use: - item  OR  1. item
- Headings MUST use: ### Heading
- Write in simple English for Tier-2/3 city readers across India.
- Short sentences (under 20 words). Max 3 lines per paragraph.
- Active, friendly, urgent tone.
- Use ONLY facts from the official PDF. Never invent dates, fees, vacancies, or links.
`;
}

// ─── PDF download ─────────────────────────────────────────────────────────────

/**
 * Safely download a PDF file and extract plain text content.
 * Resolves relative URLs, checks content-type, bounds size and text length.
 * Returns { success: true, text } or { success: false, error }.
 */
export async function downloadAndExtractPdfText(pdfUrl, watchUrl = "") {
    try {
        // Resolve relative URLs
        let resolvedUrl = pdfUrl;
        if (watchUrl && !pdfUrl.startsWith("http://") && !pdfUrl.startsWith("https://")) {
            try {
                resolvedUrl = new URL(pdfUrl, watchUrl).href;
                console.log(`🔗 [PDF] Resolved relative URL: ${pdfUrl} → ${resolvedUrl}`);
            } catch {
                console.warn(`⚠️ [PDF] Could not resolve relative URL: ${pdfUrl}`);
            }
        }

        console.log(`📥 [PDF] Downloading: ${resolvedUrl}`);
        const response = await axios.get(resolvedUrl, {
            responseType: "arraybuffer",
            timeout: PDF_TIMEOUT_MS,
            maxContentLength: PDF_MAX_BYTES,
            headers: {
                "User-Agent": "Mozilla/5.0 RojgaarSuchnaBot/3.0",
            },
            validateStatus: (status) => status >= 200 && status < 300,
        });

        // Content-type check
        const contentType = (response.headers["content-type"] || "").toLowerCase();
        const validTypes = ["application/pdf", "application/octet-stream", "binary/octet-stream"];
        if (!validTypes.some((t) => contentType.startsWith(t))) {
            return {
                success: false,
                error: `Unexpected content-type: ${contentType} (expected PDF)`,
            };
        }

        const buffer = Buffer.from(response.data);
        const pdfModule = await import("pdf-parse");
        const pdfParse = pdfModule.default || pdfModule;
        const parsed = await pdfParse(buffer);
        const extractedText = (parsed.text || "").trim();

        if (!extractedText) {
            return { success: false, error: "Extracted PDF text is empty (scanned image PDF or no text layer)" };
        }

        console.log(`✅ [PDF] Extracted ${extractedText.length} chars from PDF.`);
        return { success: true, text: extractedText };
    } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`⚠️ [PDF] Failed to download/parse PDF (${pdfUrl}): ${errorMsg}`);
        return { success: false, error: errorMsg };
    }
}

// ─── safeToPublish ────────────────────────────────────────────────────────────

/**
 * Strict safety guard before publishing any notification.
 * Returns true only if notification meets all quality & confidence criteria.
 */
export function safeToPublish(item) {
    if (!item) return false;
    if (item.relevant === false) return false;
    if (item.is_duplicate === true) return false;
    if (item.pdf_download_failed === true) return false;
    if (typeof item.confidence === "number" && item.confidence < 70) return false;
    if (!item.title || !item.category || !item.source_url) return false;
    // Require a non-empty markdown_body to ensure the blog article is present
    if (!item.markdown_body || item.markdown_body.trim().length < 50) return false;
    return true;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateHash(item, watch_uuid) {
    return crypto
        .createHash("sha256")
        .update(
            `${watch_uuid}|${item?.original_title || item?.title || ""}|${item?.notification_date || ""}|${item?.category || ""}`
        )
        .digest("hex");
}

function normalizeNotificationItem(item) {
    const normalizedCategory = normalizeNotificationCategory(
        item.category,
        item.notification_type,
        item.title,
    );

    const explanationSuffix = item.category === normalizedCategory
        ? ""
        : ` Category normalized from "${item.category || "missing"}" to "${normalizedCategory}".`;

    return {
        ...item,
        category: normalizedCategory,
        raw_explanation: `${item.raw_explanation || ""}${explanationSuffix}`.trim(),
    };
}

// ─── Core pipeline ────────────────────────────────────────────────────────────

/**
 * Core V3 Webhook Processing Engine (2-Pass Adaptive AI Pipeline).
 *
 * Receives job.data from BullMQ which includes:
 *   - all webhook payload fields (watch_uuid, diff_added, etc.)
 *   - rawEventId: string — the MongoDB _id of the corresponding RawEvent
 *
 * Throws on actual failures so BullMQ can retry.
 * Returns normally for expected non-error outcomes (irrelevant, duplicate).
 */
export const processJob = async (jobData) => {
    const { rawEventId, ...payload } = jobData;

    /**
     * Helper to update RawEvent status without crashing the pipeline.
     * A status update failure should never abort processing.
     */
    const setStatus = async (status, extra = {}) => {
        if (!rawEventId) return;
        try {
            await updateRawEventStatus(rawEventId, status, extra);
        } catch (err) {
            console.warn(`⚠️ [RawEvent] Status update to "${status}" failed: ${err.message}`);
        }
    };

    try {
        console.log(`🚀 [V3 Pipeline] Processing for Watch: ${payload.watch_title || payload.watch_uuid}`);

        // ── Step 1: Clean HTML ──────────────────────────────────────────────
        const cleanedHtml = cleanHtmlSnapshot(payload.snapshot_html || payload.html, payload.watch_url);
        const enrichedPayload = { ...payload, snapshot_html: cleanedHtml };

        // ── Step 1b: DB context — recent notifications for this watch ───────
        let recentDocs = [];
        try {
            recentDocs = await LatestNotification
                .find({ watch_uuid: payload.watch_uuid })
                .select("title original_title category notification_date dedupe_hash")
                .sort({ createdAt: -1 })
                .limit(20)
                .lean();
            console.log(`📚 [DB Context] ${recentDocs.length} recent notifications for watch: ${payload.watch_uuid}`);
        } catch (dbErr) {
            console.warn(`⚠️ [DB Context] Could not fetch recent docs: ${dbErr.message}`);
        }

        // ── Step 2: Pass 1 AI ───────────────────────────────────────────────
        await setStatus(PIPELINE_STATUS.AI_PROCESSING, { status_note: "Pass 1 AI started" });

        const promptPass1 = buildPrompt(enrichedPayload, recentDocs);
        const modelName = getTextModel();
        console.log(`🤖 [Pass 1] Calling AI model: ${modelName}`);

        let pass1Raw;
        try {
            const pass1Result = await callTextLlm(promptPass1, modelName);
            pass1Raw = pass1Result.raw || "";
        } catch (aiErr) {
            await setStatus(PIPELINE_STATUS.AI_FAILED, {
                status_note: `Pass 1 AI error: ${aiErr.message}`,
                "ai.last_error": aiErr.message.slice(0, 500),
            });
            throw new Error(`Pass 1 AI failed: ${aiErr.message}`);
        }

        // ── Step 3: Parse + Zod-validate Pass 1 response ───────────────────
        let data;
        try {
            const jsonStr = extractJsonFromText(pass1Raw);
            if (!jsonStr) throw new Error("No JSON object found in Pass 1 AI response");
            const parsed = JSON.parse(jsonStr);
            const validation = Pass1ResponseSchema.safeParse(parsed);
            if (!validation.success) {
                const issuesSummary = validation.error.issues
                    .map((i) => `${i.path.join(".")}: ${i.message}`)
                    .join("; ");
                throw new Error(`Pass 1 Zod validation failed: ${issuesSummary}`);
            }
            data = validation.data;
        } catch (parseErr) {
            await setStatus(PIPELINE_STATUS.AI_FAILED, {
                status_note: `Pass 1 parse/validation error: ${parseErr.message}`,
            });
            throw new Error(`Pass 1 response invalid: ${parseErr.message}`);
        }

        // ── Step 4: Fast exit if irrelevant ─────────────────────────────────
        if (!data.relevant || !Array.isArray(data.items) || data.items.length === 0) {
            const reason = data.reason || "Not a relevant recruitment change";
            console.log(`ℹ️ [V3 Pipeline] Irrelevant. Reason: ${reason}`);
            await setStatus(PIPELINE_STATUS.REJECTED, {
                status_note: `Irrelevant: ${reason}`,
                "ai.pass1_relevant": false,
                "ai.model": modelName,
            });
            return { processed: true, relevant: false, reason };
        }

        console.log(`📌 [Pass 1] Found ${data.items.length} notification(s).`);

        // Update RawEvent with Pass 1 meta
        await setStatus(PIPELINE_STATUS.MATCHED, {
            status_note: `Pass 1 found ${data.items.length} item(s)`,
            "ai.pass1_relevant": true,
            "ai.pass1_item_count": data.items.length,
            "ai.model": modelName,
        });

        const publishedItems = [];

        // ── Step 5: Process each item ────────────────────────────────────────
        for (let item of data.items) {
            // Skip AI-flagged duplicates (via DB context comparison)
            if (item.is_duplicate === true) {
                console.log(`🔁 [AI Duplicate] Skipping AI-identified duplicate: "${item.title}"`);
                continue;
            }

            let pdfAttempted = false;
            let pdfSuccess = false;

            // ── PDF path ────────────────────────────────────────────────────
            if (item.pdf_url && item.pdf_needs_backend_fetch) {
                pdfAttempted = true;
                console.log(`📄 [PDF] Backend fetch required: ${item.pdf_url}`);
                await setStatus(PIPELINE_STATUS.TEXT_EXTRACTING, {
                    status_note: `PDF download started: ${item.pdf_url}`,
                });

                const pdfResult = await downloadAndExtractPdfText(item.pdf_url, payload.watch_url);

                if (pdfResult.success) {
                    pdfSuccess = true;

                    // Pass 2 AI — refine item + generate markdown_body from PDF
                    const promptPass2 = buildPass2Prompt(item, pdfResult.text);
                    console.log(`🤖 [Pass 2] Refining item with official PDF content...`);

                    try {
                        const pass2Result = await callTextLlm(promptPass2, modelName);
                        const rawText2 = pass2Result.raw || "";
                        const jsonStr2 = extractJsonFromText(rawText2);
                        if (!jsonStr2) throw new Error("No JSON in Pass 2 AI response");
                        const parsed2 = JSON.parse(jsonStr2);
                        const v2 = Pass2ItemSchema.safeParse(parsed2);
                        if (!v2.success) {
                            const issues = v2.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
                            throw new Error(`Pass 2 Zod validation failed: ${issues}`);
                        }
                        // Merge: PDF is authoritative; preserve original pdf_url
                        item = { ...item, ...v2.data, pdf_url: item.pdf_url };
                        console.log(`✨ [Pass 2] Item refined with official PDF.`);
                    } catch (p2Err) {
                        // Pass 2 failure: keep Pass 1 item, mark for review
                        console.warn(`⚠️ [Pass 2] Failed: ${p2Err.message}. Falling back to Pass 1 item.`);
                        item.raw_explanation = `${item.raw_explanation || ""} [Pass2 failed: ${p2Err.message}]`.trim();
                        item.confidence = Math.min(item.confidence || 50, 60);
                        item.pdf_download_failed = true; // → pending_review
                    }
                } else {
                    // PDF download/parse failed
                    item.pdf_download_failed = true;
                    item.confidence = Math.min(item.confidence || 50, 55);
                    item.raw_explanation = `${item.raw_explanation || ""} [PDF Download Failed: ${pdfResult.error}]`.trim();
                    console.warn(`⚠️ [PDF] Download failed for item "${item.title}": ${pdfResult.error}`);
                }
            }

            // ── Blog fallback — only when no Pass 2 markdown_body ──────────
            // Run ONLY if markdown_body is missing/too short AND pdf path was not taken or failed
            //  this is use less that is why i have commented  leter i wil remove it
            // if (!item.markdown_body || item.markdown_body.trim().length < 50) {
            //     console.log(`📝 [Blog Fallback] markdown_body missing — generating via createAIBlog...`);
            //     try {
            //         const fallbackText = (
            //             payload.diff_added ||
            //             payload.snapshot_html ||
            //             payload.diff ||
            //             ""
            //         ).slice(0, 12000);
            //         if (fallbackText.trim()) {
            //             const blogContent = await createAIBlog(fallbackText);
            //             if (blogContent && blogContent.trim().length >= 50) {
            //                 item.markdown_body = blogContent;
            //                 console.log(`✅ [Blog Fallback] markdown_body generated successfully.`);
            //             }
            //         }
            //     } catch (blogErr) {
            //         console.warn(`⚠️ [Blog Fallback] createAIBlog failed: ${blogErr.message}`);
            //     }
            // }

            // ── Normalize category & generate L2 dedup hash ─────────────────
            const normalizedItem = normalizeNotificationItem(item);
            const dedupeHash = generateHash(normalizedItem, data.watch_uuid || payload.watch_uuid);

            // ── L2 Atomic deduplication ──────────────────────────────────────
            // Use findOneAndUpdate + $setOnInsert for atomic insert.
            // If the document already exists, result.lastErrorObject.updatedExisting = true.
            const rawDate = normalizedItem.notification_date;
            const parsedDate = rawDate ? Date.parse(rawDate) : NaN;
            const validNotificationDate = !isNaN(parsedDate) ? new Date(parsedDate) : new Date();

            const isPublishable = safeToPublish(normalizedItem);
            const baseSlug = buildSlug(normalizedItem);
            const slug = await generateUniqueSlug(baseSlug, LatestNotification);

            const notificationDoc = {
                watch_uuid: data.watch_uuid || payload.watch_uuid,
                source_event_id: rawEventId || undefined,
                title: normalizedItem.title,
                original_title: normalizedItem.original_title || normalizedItem.title,
                slug,
                summary: normalizedItem.summary,
                source_url: normalizedItem.source_url || payload.watch_url,
                pdf_url: normalizedItem.pdf_url || null,
                markdown_body: normalizedItem.markdown_body || null,
                department: normalizedItem.department || payload.watch_title,
                body: normalizedItem.body || normalizedItem.summary,
                category: normalizedItem.category,
                notification_type: normalizedItem.notification_type || "Other",
                notification_date: validNotificationDate,
                notification_date_raw: rawDate || null,
                new_or_updated: normalizedItem.new_or_updated || "New",
                publish: isPublishable,
                status: isPublishable ? "published" : "pending_review",
                dedupe_hash: dedupeHash,
                ai: {
                    confidence: normalizedItem.confidence || 80,
                    explanation: normalizedItem.raw_explanation || "",
                    model: modelName,
                },
                webhook_payload: payload,
                ai_response: data,
            };

            let savedDoc;
            let isDuplicate = false;

            try {
                // Atomic upsert: $setOnInsert only executes on new insert
                const result = await LatestNotification.findOneAndUpdate(
                    { dedupe_hash: dedupeHash },
                    { $setOnInsert: notificationDoc },
                    {
                        upsert: true,
                        new: true,
                        setDefaultsOnInsert: true,
                        rawResult: true,
                    }
                );

                // Detect whether this was an insert or an existing doc
                isDuplicate = !result.lastErrorObject?.upserted;
                savedDoc = result.value;

                if (isDuplicate) {
                    console.log(`🔁 [L2 Dedup] Notification already exists in DB: "${normalizedItem.title}"`);
                } else {
                    console.log(`✅ [DB] Notification stored (status="${notificationDoc.status}"): "${normalizedItem.title}"`);
                }
            } catch (dbErr) {
                // E11000 = race-condition duplicate on the unique index — treat as duplicate, not error
                if (dbErr.code === 11000) {
                    isDuplicate = true;
                    console.log(`🔁 [L2 Dedup] Race-condition duplicate caught (E11000): "${normalizedItem.title}"`);
                } else {
                    throw new Error(`Database write failed: ${dbErr.message}`);
                }
            }

            if (!isDuplicate && savedDoc) {
                publishedItems.push({
                    id: savedDoc._id,
                    title: savedDoc.title,
                    status: savedDoc.status,
                });
            }
        }

        // ── Step 6: Final RawEvent status update ────────────────────────────
        if (publishedItems.length === 0) {
            // All items were duplicates or skipped
            await setStatus(PIPELINE_STATUS.DUPLICATE, {
                status_note: "All extracted notifications already existed in DB",
                "published.status": "duplicate",
                "published.at": new Date(),
                "ai.pdf_attempted": false,
            });
        } else {
            const allPublished = publishedItems.every((i) => i.status === "published");
            const finalStatus = allPublished ? PIPELINE_STATUS.PUBLISHED : PIPELINE_STATUS.PENDING_REVIEW;
            await setStatus(finalStatus, {
                status_note: `${publishedItems.length} notification(s) saved`,
                "published.notification_ids": publishedItems.map((i) => i.id),
                "published.status": finalStatus,
                "published.at": new Date(),
            });
        }

        return { processed: true, relevant: true, publishedCount: publishedItems.length };

    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`❌ [V3 Pipeline Error] ${message}`);
        // Re-throw so BullMQ retries (attempt count increments)
        throw new Error(`V3 pipeline failed: ${message}`);
    }
};
