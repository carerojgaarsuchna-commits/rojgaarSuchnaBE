import { z } from "zod";
import { callTextLlm, getTextModel } from "./ai-api/aiProvider.js";
import crypto from "crypto";
import axios from "axios";
import { createRequire } from "module";
import { UnrecoverableError } from "bullmq";
import { LatestNotification } from "../models/LatestNotification.js";
import { normalizeNotificationCategory } from "../utils/notificationCategory.js";
import { buildSlug, generateUniqueSlug } from "../utils/helper.js";
import { updateRawEventStatus } from "../services/pipeline/rawEvent.service.js";
import { PIPELINE_STATUS } from "../constants/pipelineStatus.js";
import { fetchWatchSnapshot } from "./changedetection.service.js";
import { buildPass1Prompt, buildPass2Prompt } from "./prompt-ai.js";

// pdf-parse is a CJS module — dynamic import() does not interop reliably in ESM.
// createRequire is the standard Node.js fix for CJS packages in ESM files.
const _require = createRequire(import.meta.url);
const pdfParse = _require("pdf-parse").PDFParse; // v2.x exports object; callable is .PDFParse

// ─── Env config ───────────────────────────────────────────────────────────────
const PDF_TIMEOUT_MS = Number(process.env.PDF_TIMEOUT_MS) || 15000;
const PDF_MAX_BYTES = Number(process.env.PDF_MAX_BYTES) || 10 * 1024 * 1024; // 10 MB
const PDF_TEXT_LIMIT = Number(process.env.PDF_TEXT_LIMIT) || 15000;

// ─── Zod schemas for AI output validation ────────────────────────────────────

const Pass1ItemSchema = z.object({
    title: z.string().min(1),
    // Contract explicitly allows "" when no exact official title is available —
    // must NOT require min(1) or valid AI output gets rejected.
    original_title: z.string().optional().default(""),
    summary: z.string().min(1),
    source_url: z.string().min(1),
    department: z.string().optional().default(""),
    body: z.string().optional().default(""),
    category: z.string().min(1),
    notification_type: z.string().optional().default("Other"),
    notification_date: z.string().optional().default(""),
    application_last_date: z.string().optional().default(""),
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
    original_title: z.string().optional().default(""),
    summary: z.string().optional(),
    source_url: z.string().optional(),
    pdf_url: z.string().nullable().optional(),
    department: z.string().optional().default(""),
    body: z.string().optional().default(""),
    category: z.string().optional(),
    notification_type: z.string().optional(),
    notification_date: z.string().optional(),
    application_last_date: z.string().optional(),
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
 * Clean HTML snapshot for AI processing.
 *
 * ONLY removes CSS and JavaScript.
 * Does NOT modify HTML structure, links, attributes, images,
 * headers, footers, navigation, or visible content.
 */
export function cleanHtmlSnapshot(rawHtml) {
    if (!rawHtml || typeof rawHtml !== "string") {
        return "";
    }

    let html = rawHtml;

    // Remove <script>...</script>
    html = html.replace(
        /<script\b[^>]*>[\s\S]*?<\/script>/gi,
        ""
    );

    // Remove <style>...</style>
    html = html.replace(
        /<style\b[^>]*>[\s\S]*?<\/style>/gi,
        ""
    );

    return html.trim();
}

// ─── Title normalization (for dedupe hashing) ─────────────────────────────────

/**
 * Normalize a title for use in the dedupe hash: lowercase, collapse
 * whitespace, strip punctuation noise. Two near-identical titles scraped
 * with slightly different whitespace/casing must hash identically.
 */
export function normalizeTitleForHash(title) {
    return (title || "")
        .toLowerCase()
        .normalize("NFKC")
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .replace(/\s+/g, " ")
        .trim();
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

/**
 * Safely download a PDF file and extract plain text content.
 * Resolves relative URLs, checks content-type, bounds size and text length.
 * Text is truncated to PDF_TEXT_LIMIT before being handed to any LLM call,
 * to bound token cost/latency on unusually large documents.
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

        // pdf-parse v2 API: PDFParse is a class, not a direct callable.
        const parser = new pdfParse({ data: buffer });
        let extractedText = "";
        try {
            const parsed = await parser.getText();
            extractedText = (parsed.text || "").trim();
        } finally {
            await parser.destroy(); // always release parser resources
        }

        if (!extractedText) {
            return { success: false, error: "Extracted PDF text is empty (scanned image PDF or no text layer)" };
        }

        // Bound the text length before it's ever handed to an LLM prompt.
        let truncated = false;
        if (extractedText.length > PDF_TEXT_LIMIT) {
            extractedText = extractedText.slice(0, PDF_TEXT_LIMIT);
            truncated = true;
        }

        console.log(
            `✅ [PDF] Extracted ${extractedText.length} chars from PDF.` +
            (truncated ? ` (truncated to PDF_TEXT_LIMIT=${PDF_TEXT_LIMIT})` : "")
        );
        return { success: true, text: extractedText, truncated };
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
    const normalizedTitle = normalizeTitleForHash(item?.original_title || item?.title || "");
    return crypto
        .createHash("sha256")
        .update(`${watch_uuid}|${normalizedTitle}|${item?.notification_date || ""}`)
        .digest("hex");
}

/**
 * Classify AI errors as permanent (non-retryable) vs transient.
 * Permanent errors include quota exhaustion, invalid credentials, unknown model.
 * Transient errors (network, 429 temporary, timeout) should still be retried.
 */
function isPermanentAIError(message = "") {
    return (
        /rate.limit.exceeded.*free-models-per-day/i.test(message) ||
        /insufficient.credits/i.test(message) ||
        /invalid.api.key/i.test(message) ||
        /model.*not.*(found|available)/i.test(message)
    );
}

/**
 * Build a deterministic minimal markdown article from Pass 1 structured data.
 * Used when no Pass 2 ran (no PDF, or PDF fetch/refinement failed). Guarantees
 * markdown_body exists without making an extra LLM call (zero hallucination risk).
 */
function buildDeterministicMarkdown(item, sourceUrl) {
    const department = item.department || "";
    const notifDate = item.notification_date || "";
    const lastDate = item.application_last_date || "";

    const rows = [
        `| **Category**          | ${item.category || "—"} |`,
        `| **Notification Type** | ${item.notification_type || "—"} |`,
        department ? `| **Department**        | ${department} |` : null,
        notifDate ? `| **Notification Date** | ${notifDate} |` : null,
        lastDate ? `| **Last Date to Apply**| ${lastDate} |` : null,
        `| **Status**            | ${item.new_or_updated || "New"} |`,
    ].filter(Boolean).join("\n");

    return [
        `# ${item.title}`,
        ``,
        `> **${item.notification_type || item.category}**${department ? " — " + department : ""}`,
        ``,
        `## Summary`,
        ``,
        item.summary || "",
        ``,
        `## Details`,
        ``,
        `| Field | Value |`,
        `|-------|-------|`,
        rows,
        ``,
        `## How to Check / Apply`,
        ``,
        `Visit the official website for complete details and to submit your application or check the notification.`,
        ``,
        `**Official Source:** [${sourceUrl}](${sourceUrl})`,
    ].join("\n");
}

/**
 * Evidence Gate — determines whether an AI-extracted notification item is
 * grounded in the actual changed content (diff_added or diff).
 *
 * Returns { valid: boolean, evidenceType: string, matchedToken: string|null, score: number }
 *
 * Token tiers:
 *   Strong  (score 3) — CEN/advt number, exact multi-word official phrase (≥ 3 words, ≥ 12 chars from original_title)
 *   Medium  (score 2) — 2-word meaningful pair, post name + year, date in any recognisable format
 *   Weak    (score 1) — single generic word (never passes alone)
 *
 * Passing threshold: score ≥ 3 (one Strong OR two Medium).
 * Weak tokens alone are never sufficient.
 *
 * When evidenceSource is null (neither diff_added nor diff available),
 * the gate rejects — it does NOT silently pass.
 */
export function checkDiffEvidence(item, evidenceText, evidenceSource) {
    // No diff source → cannot verify, must reject
    if (!evidenceSource || !evidenceText || evidenceText.trim().length === 0) {
        return { valid: false, evidenceType: "no_source", matchedToken: null, score: 0 };
    }

    const haystack = evidenceText.toLowerCase();

    // ── Extract candidate tokens from original_title (preferred) then title ──
    const rawTitle = (item.original_title || item.title || "").trim();
    const generatedTitle = (item.title || "").trim();

    // Generic words to exclude from meaningful matches
    const STOP_WORDS = new Set([
        "recruitment", "vacancy", "vacancies", "notification", "notice",
        "result", "admit", "card", "application", "online", "apply",
        "exam", "the", "for", "and", "of", "in", "at", "to", "by",
        "post", "posts", "jobs", "job", "new", "updated", "government",
        "india", "2026", "2025", "2024", "board", "department",
    ]);

    const isStopWord = (w) => STOP_WORDS.has(w.toLowerCase());

    let bestScore = 0;
    let bestToken = null;

    // ── STRONG: CEN / advertisement / circular numbers ──
    const cenPattern = /\bCEN[\s-]+[\d]+\/[\d]+\b|\bCEN[\s-]+[\d]+\b/gi;
    const advtPattern = /\b(?:advt|advertisement|circular|notification)[\.\s#-]*no[\.\s]*[\w\/\d-]+/gi;
    const docPattern = /\b[\w-]+\.pdf\b|\b[\w-]+\.docx\b/gi;

    for (const pattern of [cenPattern, advtPattern, docPattern]) {
        const sourceMatches = rawTitle.match(pattern) || [];
        for (const token of sourceMatches) {
            if (haystack.includes(token.toLowerCase())) {
                return { valid: true, evidenceType: evidenceSource, matchedToken: token, score: 3 };
            }
        }
    }

    // ── STRONG: multi-word exact phrase from original_title (≥ 3 words, ≥ 12 chars) ──
    const titleWords = rawTitle
        .replace(/[^a-zA-Z0-9 ]/g, " ")
        .split(/\s+/)
        .map(w => w.toLowerCase())
        .filter(w => w.length >= 3 && !isStopWord(w));

    // Build trigrams from meaningful words
    for (let i = 0; i <= titleWords.length - 3; i++) {
        const phrase = titleWords.slice(i, i + 3).join(" ");
        if (phrase.length >= 12 && haystack.includes(phrase)) {
            bestScore = 3;
            bestToken = phrase;
            break;
        }
    }

    if (bestScore >= 3) {
        return { valid: true, evidenceType: evidenceSource, matchedToken: bestToken, score: bestScore };
    }

    // ── MEDIUM: bigrams (2-word pairs) from original_title ──
    for (let i = 0; i <= titleWords.length - 2; i++) {
        const pair = `${titleWords[i]} ${titleWords[i + 1]}`;
        if (pair.length >= 8 && haystack.includes(pair)) {
            bestScore = Math.max(bestScore, 2);
            if (!bestToken) bestToken = pair;
        }
    }

    // Need two Medium hits (score >= 4) or one Strong hit (score >= 3)
    // One bigram alone (score 2) is insufficient — check for a second match
    if (bestScore >= 2) {
        // Count total medium matches
        let mediumCount = 0;
        let firstToken = null;
        for (let i = 0; i <= titleWords.length - 2; i++) {
            const pair = `${titleWords[i]} ${titleWords[i + 1]}`;
            if (pair.length >= 8 && haystack.includes(pair)) {
                mediumCount++;
                if (!firstToken) firstToken = pair;
            }
        }
        if (mediumCount >= 2) {
            return { valid: true, evidenceType: evidenceSource, matchedToken: firstToken, score: 4 };
        }
    }

    // ── MEDIUM: date match (any recognisable format) ──
    const notifDate = (item.notification_date || "").trim(); // YYYY-MM-DD
    if (notifDate && notifDate.length >= 8) {
        // Generate multiple date formats
        const [year, month, day] = notifDate.split("-");
        const dateVariants = [
            notifDate,                          // 2026-07-14
            `${day}-${month}-${year}`,          // 14-07-2026
            `${day}/${month}/${year}`,          // 14/07/2026
            `${day}.${month}.${year}`,          // 14.07.2026
        ].filter(Boolean);

        for (const variant of dateVariants) {
            if (haystack.includes(variant.toLowerCase())) {
                bestScore = Math.max(bestScore, 2);
                bestToken = bestToken || `date:${variant}`;
            }
        }
    }

    // ── WEAK: single meaningful word from generated title ──
    // (never sufficient alone, logged only)
    const genWords = generatedTitle
        .replace(/[^a-zA-Z0-9 ]/g, " ")
        .split(/\s+/)
        .map(w => w.toLowerCase())
        .filter(w => w.length >= 5 && !isStopWord(w));

    let weakScore = 0;
    for (const word of genWords) {
        if (haystack.includes(word)) {
            weakScore = 1;
            if (!bestToken) bestToken = word;
            break;
        }
    }

    // Final decision: need score >= 3 to pass
    const finalScore = bestScore > 0 ? bestScore : weakScore;
    return {
        valid: finalScore >= 3,
        evidenceType: evidenceSource,
        matchedToken: bestToken,
        score: finalScore,
    };
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
 * Pass 1: relevance + extraction + PDF discovery, merged, → items[].
 * Pass 2: per-item, only when a PDF was found AND downloaded AND text
 *         extracted, refine the item + generate the blog article.
 * Items with no PDF (or a failed PDF fetch) get a deterministic markdown
 * fallback instead of a second LLM call — zero hallucination risk.
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

        // ── Step 1: Parallel — DB context + ChangeDetection API snapshot fetch ──
        // Both are best-effort: failures warn but never abort the pipeline.
        let liveHtml = "";

        await Promise.allSettled([


            // 1b: fetch latest HTML snapshot from ChangeDetection API.
            // Wrapped in its own try/catch — a failure here must warn and
            // leave liveHtml empty, never abort the whole job or swallow
            // silently the way Promise.allSettled would otherwise let it.
            (async () => {
                try {
                    const raw = await fetchWatchSnapshot(payload.watch_uuid);
                    if (raw) {
                        liveHtml = cleanHtmlSnapshot(raw);
                        console.log(`🌐 [CDIO] Cleaned snapshot: ${liveHtml.length} chars for watch: ${payload.watch_uuid}`);
                    }

                } catch (snapErr) {
                    console.warn(`⚠️ [CDIO] Snapshot fetch failed: ${snapErr.message}`);
                }
            })(),
        ]);

        // Determine which diff source Pass 1 will use — same source the Evidence Gate checks.
        const evidenceSource = payload.diff_added?.trim()
            ? "diff_added"
            : payload.diff?.trim()
                ? "diff"
                : null;
        // ── Step 2: Pass 1 AI — relevance + extraction + PDF discovery ──────
        const enrichedPayload = { ...payload, snapshot: liveHtml };
        const promptPass1 = buildPass1Prompt(enrichedPayload);

        const modelName = getTextModel();

        await setStatus(PIPELINE_STATUS.AI_PROCESSING, {
            status_note: "Pass 1 AI started",
            "ai.prompt_pass1": promptPass1,   // full prompt stored for inspection
        });
        console.log(`🤖 [Pass 1] Calling AI model: ${modelName}`);

        let pass1Raw;
        try {
            const pass1Result = await callTextLlm(promptPass1, modelName);
            pass1Raw = pass1Result.raw || "";
        } catch (aiErr) {
            const permanent = isPermanentAIError(aiErr.message);
            await setStatus(PIPELINE_STATUS.AI_FAILED, {
                status_note: `Pass 1 AI error: ${aiErr.message}`,
                "ai.last_error": aiErr.message.slice(0, 500),
                "ai.permanent_failure": permanent,
            });
            // Quota/key/model errors are permanent — BullMQ must NOT retry.
            if (permanent) {
                throw new UnrecoverableError(`Pass 1 AI failed (permanent): ${aiErr.message}`);
            }
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

        // Outcome counters — kept distinct so the final status note is
        // accurate instead of lumping evidence-gate rejections, AI-flagged
        // duplicates, and real DB duplicates into one misleading bucket.
        let evidenceRejectedCount = 0;
        let aiDuplicateSkippedCount = 0;
        let dbDuplicateCount = 0;

        // Job-level PDF tracking — OR-assigned inside the loop so any item that
        // triggers the PDF path sets the flag for the whole job.
        let jobPdfAttempted = false;
        let jobPdfSuccess = false;

        // Page HTML cache for Step 4.5 URL resolution.
        // Fetched at most once per job — reused for all items that need it.
        let resolvedPageHtml = null;

        // ── Step 5: Process each item ────────────────────────────────────────
        for (let item of data.items) {
            // Skip AI-flagged duplicates. Per the Pass 1 contract this is
            // always false, but the check is cheap and harmless to keep as
            // a defensive backstop — real dedup happens later via the
            // deterministic hash + atomic DB check regardless.
            if (item.is_duplicate === true) {
                aiDuplicateSkippedCount++;
                console.log(`🔁 [AI Duplicate] Skipping AI-identified duplicate: "${item.title}"`);
                continue;
            }

            // ── Evidence Gate ────────────────────────────────────────────────
            // Verify that this notification is actually grounded in the changed
            // content (diff_added or diff) — not extracted from the full HTML snapshot.
            // This is the primary guard against counter/timestamp-only events
            // producing false-positive notifications.
            const evidenceText = evidenceSource === "diff_added"
                ? (payload.diff_added || "")
                : (payload.diff || "");
            const gateResult = checkDiffEvidence(item, evidenceText, evidenceSource);

            if (!gateResult.valid) {
                evidenceRejectedCount++;
                console.warn(
                    `🚫 [Evidence Gate] Item rejected — score ${gateResult.score}/3 ` +
                    `(source: ${gateResult.evidenceType}): "${item.title}"`
                );
                await setStatus(PIPELINE_STATUS.REJECTED, {
                    status_note: `Evidence gate rejected: "${item.title}" ` +
                        `(score ${gateResult.score}/3, source: ${gateResult.evidenceType})`,
                });
                continue;
            }

            console.log(
                `✅ [Evidence Gate] Passed — score ${gateResult.score}/3 ` +
                `matched "${gateResult.matchedToken}" in ${gateResult.evidenceType}: "${item.title}"`
            );

            let pdfSuccess = false;

            // ── Step 4.5: Resolve filename → full URL ────────────────────────
            // Pass 1 AI may return a bare filename as pdf_url (e.g. "14082026-864_0001.pdf")
            // because the snapshot is text-only and hrefs are stripped.
            // Fetch the source page HTML once per job and extract the matching href.
            if (item.pdf_url && !item.pdf_url.startsWith("http")) {
                const filename = item.pdf_url;
                try {
                    // Lazy-fetch and cache the source page HTML for this job
                    if (!resolvedPageHtml && payload.watch_url) {
                        const pageRes = await axios.get(payload.watch_url, {
                            timeout: Number(process.env.PIPELINE_HTML_TIMEOUT_MS) || 4000,
                            maxContentLength: 5 * 1024 * 1024,
                            responseType: "text",
                            headers: { "User-Agent": "Mozilla/5.0 RojgaarSuchnaBot/3.0" },
                            validateStatus: (s) => s >= 200 && s < 300,
                        });
                        resolvedPageHtml = pageRes.data || "";
                        console.log(`🔍 [URL Resolve] Fetched source page (${resolvedPageHtml.length} chars): ${payload.watch_url}`);
                    }

                    // Search page HTML for any href that ends with /filename.
                    // Requiring '/' before the filename prevents substring matches
                    // (e.g. matching '114082026-864.pdf' when looking for '14082026-864.pdf').
                    const escaped = filename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                    const hrefMatch = resolvedPageHtml.match(
                        new RegExp(`href=["']([^"']*?/${escaped})(?=["'?#])`, "i")
                    );
                    const hrefPath = hrefMatch?.[1] ?? null;

                    if (hrefPath) {
                        item.pdf_url = new URL(hrefPath, payload.watch_url).href;
                        console.log(`🔗 [URL Resolve] ${filename} → ${item.pdf_url}`);
                    } else {
                        // Href not found in page — clear so we don't attempt a broken download
                        console.warn(`⚠️ [URL Resolve] href for "${filename}" not found in source page. Clearing pdf_url.`);
                        item.pdf_url = null;
                    }
                } catch (resolveErr) {
                    // Page fetch failed — clear to avoid a bad download attempt
                    console.warn(`⚠️ [URL Resolve] Source page fetch failed: ${resolveErr.message}. Clearing pdf_url.`);
                    item.pdf_url = null;
                }
            }

            // ── PDF path ────────────────────────────────────────────────────
            // Whether to attempt a fetch is decided deterministically by the
            // backend from pdf_url alone — the AI's pdf_needs_backend_fetch
            // flag is informational only and is never trusted on its own,
            // since a mismatch there must not silently skip a real document.
            if (item.pdf_url) {
                jobPdfAttempted = true;
                console.log(`📄 [PDF] Backend fetch required: ${item.pdf_url}`);
                await setStatus(PIPELINE_STATUS.TEXT_EXTRACTING, {
                    status_note: `PDF download started: ${item.pdf_url}`,
                });

                const pdfResult = await downloadAndExtractPdfText(item.pdf_url, payload.watch_url);

                if (pdfResult.success) {
                    pdfSuccess = true;
                    jobPdfSuccess = true;

                    // Pass 2 AI — refine item + generate markdown_body from PDF
                    console.log(`🤖 [Pass 2] Refining item with official PDF content...`);

                    try {
                        const promptPass2 = buildPass2Prompt(item, pdfResult.text);
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
                        // Merge: PDF-refined fields win; preserve original pdf_url
                        item = { ...item, ...v2.data, pdf_url: item.pdf_url };
                        console.log(`✨ [Pass 2] Item refined with official PDF.`);
                    } catch (p2Err) {
                        // Pass 2 failure: keep Pass 1 item, mark for review.
                        // The deterministic markdown fallback below still runs,
                        // so this item is never left without a blog body.
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

            // ── Deterministic markdown fallback ──────────────────────────────
            // When no Pass 2 ran (no PDF, or PDF fetch/refinement failed), generate
            // a minimal but complete markdown article from the structured item data.
            // This is deterministic — no extra LLM call, zero hallucination risk.
            // safeToPublish() still gates on confidence/pdf_download_failed etc.,
            // so not all records will auto-publish even after this runs.
            if (!item.markdown_body || item.markdown_body.trim().length < 50) {
                item.markdown_body = buildDeterministicMarkdown(
                    item,
                    item.source_url || payload.watch_url || ""
                );
                console.log(`📝 [Markdown Fallback] Deterministic article built for: "${item.title}"`);
            }

            // ── Normalize category & generate L2 dedup hash ─────────────────
            const normalizedItem = normalizeNotificationItem(item);
            const dedupeHash = generateHash(normalizedItem, data.watch_uuid || payload.watch_uuid);

            // ── L2 Atomic deduplication ──────────────────────────────────────
            // Use findOneAndUpdate + $setOnInsert for atomic insert.
            // If the document already exists, result.lastErrorObject.updatedExisting = true.
            const rawDate = normalizedItem.notification_date;
            const parsedDate = rawDate ? Date.parse(rawDate) : NaN;
            const validNotificationDate = !isNaN(parsedDate) ? new Date(parsedDate) : new Date();

            // application_last_date — keep distinct from notification_date
            const rawLastDate = normalizedItem.application_last_date || "";
            const parsedLastDate = rawLastDate ? Date.parse(rawLastDate) : NaN;
            const validApplicationLastDate = !isNaN(parsedLastDate) ? new Date(parsedLastDate) : undefined;

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
                application_last_date: validApplicationLastDate,
                application_last_date_raw: rawLastDate || null,
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
                // Traceability: which diff token proved this notification
                source_evidence: {
                    evidence_source: gateResult.evidenceType || evidenceSource || "unknown",
                    matched_token: gateResult.matchedToken || null,
                    score: gateResult.score || 0,
                },
            };

            // Strip sibling items from ai_response before storing.
            // Each LatestNotification doc represents ONE item. Storing the entire
            // items[] array (with all N siblings) is pure bloat and a footgun
            // for anything that reads ai_response.items[0] assuming it's "this doc's item".
            // We store only the pass-level metadata + the specific extracted item.
            const aiResponseForDoc = {
                relevant: data.relevant,
                publish: data.publish,
                watch_uuid: data.watch_uuid,
                // _item: the specific item this document was created from
                _item: normalizedItem,
                // total_siblings: how many items this event generated (for reference)
                total_siblings: data.items?.length ?? 1,
            };

            // Overwrite ai_response in the doc with the stripped version
            notificationDoc.ai_response = aiResponseForDoc;

            let savedDoc;
            let isDuplicate = false;

            try {
                // Atomic upsert: $setOnInsert only executes on new insert.
                // Use new: false so the pre-update document tells us:
                //   - null   → nothing existed → this was a new insert
                //   - object → doc existed    → this is a duplicate
                // This is more reliable than checking lastErrorObject.upserted,
                // which behaves inconsistently across Mongoose versions when new:true.
                //
                // Result shape is NOT stable across Mongoose/driver versions:
                //   - some versions wrap it: { value, lastErrorObject, ok } (value may be null)
                //   - other versions (rawResult renamed to includeResultMetadata in
                //     Mongoose 7+/8+) return the document UNWRAPPED — meaning the
                //     whole `result` itself is null on a fresh insert, not `{value:null}`.
                // Passing both option names covers both APIs; normalizing the shape
                // below means a Mongoose version bump can't crash this again.
                const result = await LatestNotification.findOneAndUpdate(
                    { dedupe_hash: dedupeHash },
                    { $setOnInsert: notificationDoc },
                    {
                        upsert: true,
                        new: false,                 // return PRE-update doc (null = new insert)
                        setDefaultsOnInsert: true,
                        rawResult: true,             // legacy Mongoose option name
                        includeResultMetadata: true, // canonical name in Mongoose 7+/8+
                    }
                );

                const preUpdateDoc = result && typeof result === "object" && "value" in result
                    ? result.value
                    : (result ?? null);

                isDuplicate = preUpdateDoc !== null;

                if (isDuplicate) {
                    savedDoc = preUpdateDoc; // existing doc
                    dbDuplicateCount++;
                    console.log(`🔁 [L2 Dedup] Notification already exists in DB: "${normalizedItem.title}"`);
                } else {
                    // New insert: fetch the doc we just created so we have its _id
                    savedDoc = await LatestNotification.findOne({ dedupe_hash: dedupeHash }).lean();
                    console.log(`✅ [DB] Notification stored (status="${notificationDoc.status}"): "${normalizedItem.title}"`);
                }
            } catch (dbErr) {
                // E11000 = race-condition duplicate on the unique index — treat as duplicate, not error
                if (dbErr.code === 11000) {
                    isDuplicate = true;
                    dbDuplicateCount++;
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
        // Each outcome bucket is reported separately so the status note is
        // accurate — evidence-gate rejections and AI-flagged duplicates are
        // NOT the same thing as a real DB duplicate, and conflating them
        // hides real pipeline behaviour from anyone reading the status log.
        const newCount = publishedItems.length;
        const skippedNote = [
            evidenceRejectedCount > 0 ? `${evidenceRejectedCount} rejected by evidence gate` : null,
            aiDuplicateSkippedCount > 0 ? `${aiDuplicateSkippedCount} AI-flagged duplicate` : null,
            dbDuplicateCount > 0 ? `${dbDuplicateCount} already existed in DB` : null,
        ].filter(Boolean).join(", ");

        if (newCount === 0) {
            await setStatus(PIPELINE_STATUS.NOTIFICATION_DUPLICATE, {
                status_note: skippedNote
                    ? `No new notifications. ${skippedNote}.`
                    : "No new notifications saved.",
                "published.status": "notification_duplicate",
                "published.new": 0,
                "published.evidence_rejected": evidenceRejectedCount,
                "published.ai_duplicate": aiDuplicateSkippedCount,
                "published.db_duplicate": dbDuplicateCount,
                "published.at": new Date(),
                "ai.pdf_attempted": jobPdfAttempted,
                "ai.pdf_success": jobPdfSuccess,
            });
        } else {
            const allPublished = publishedItems.every((i) => i.status === "published");
            const finalStatus = allPublished ? PIPELINE_STATUS.PUBLISHED : PIPELINE_STATUS.PENDING_REVIEW;
            await setStatus(finalStatus, {
                status_note: `${newCount} new notification(s) saved` + (skippedNote ? `; ${skippedNote}` : ""),
                "published.notification_ids": publishedItems.map((i) => i.id),
                "published.status": finalStatus,
                "published.new": newCount,
                "published.evidence_rejected": evidenceRejectedCount,
                "published.ai_duplicate": aiDuplicateSkippedCount,
                "published.db_duplicate": dbDuplicateCount,
                "published.at": new Date(),
                "ai.pdf_attempted": jobPdfAttempted,
                "ai.pdf_success": jobPdfSuccess,
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