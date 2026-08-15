import { callTextLlm, getTextModel } from "./ai-api/aiProvider.js";
import crypto from "crypto";
import axios from "axios";
import { LatestNotification } from "../models/LatestNotification.js";
import {
    normalizeNotificationCategory,
} from "../utils/notificationCategory.js";
import { buildSlug, generateUniqueSlug, isValidAIResponse } from "../utils/helper.js";

/**
 * Clean full page HTML snapshot for AI processing.
 * 
 * Why: Raw HTML contains scripts, styles, headers, footers, and SVGs that waste AI tokens.
 * What it does:
 * 1. Removes script, style, nav, footer, header tags and SVGs.
 * 2. Converts relative links (e.g. href="/pdf/notice.pdf") to absolute links (e.g. https://ssc.gov.in/pdf/notice.pdf).
 * 3. Keeps clean HTML with clickable links preserved.
 */
export function cleanHtmlSnapshot(rawHtml, baseUrl = "") {
    if (!rawHtml || typeof rawHtml !== "string") {
        return "";
    }

    let html = rawHtml;

    // Remove script, style, nav, footer, header, svg tags and their content
    html = html.replace(/<(script|style|nav|footer|header|svg)[\s\S]*?<\/\1>/gi, "");

    // Remove inline base64 images to save tokens
    html = html.replace(/src=["']data:image\/[^"']+["']/gi, 'src=""');

    // Convert relative href links to absolute URLs if baseUrl is provided
    if (baseUrl) {
        html = html.replace(/href=["']([^"']+)["']/gi, (match, hrefValue) => {
            try {
                // Ignore javascript:, mailto:, tel:, # anchor links
                if (hrefValue.startsWith("javascript:") || hrefValue.startsWith("mailto:") || hrefValue.startsWith("#")) {
                    return match;
                }
                const absoluteUrl = new URL(hrefValue, baseUrl).href;
                return `href="${absoluteUrl}"`;
            } catch (err) {
                // If URL parsing fails, keep original href
                return match;
            }
        });
    }

    // Collapse multiple blank lines or extra whitespace
    return html.replace(/\n\s*\n/g, "\n").trim();
}

/**
 * Generate unique SHA-256 hash for incoming webhook event.
 * Used at the controller level to discard duplicate webhooks instantly.
 */
export function buildEventHash(watchUuid, changeDatetime, diffAdded = "") {
    const rawString = `${watchUuid || ""}|${changeDatetime || ""}|${diffAdded || ""}`;
    return crypto.createHash("sha256").update(rawString).digest("hex");
}

/**
 * Remove secret key from payload before saving to Database or BullMQ queue.
 * Keeps system credentials safe in logs and DB records.
 */
export function stripSecretFromPayload(payload) {
    if (!payload || typeof payload !== "object") return {};
    const { secret, ...safePayload } = payload;
    return safePayload;
}
function buildPrompt(payload) {
    const {
        watch_uuid,
        watch_title,
        watch_url,
        change_datetime,
        diff,
        diff_added,
        diff_removed,
        triggered_text
    } = payload;
    console.log('diff_added----', diff_added);
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

   ==================================================
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

    - Job
    - Job Vacancy
    - Recruitment Advertisement
    - Result
    - Admit Card
    - Answer Key
    - Admission
    - Syllabus
    - Exam Schedule
    - Interview Schedule
    - Document Verification
    - Medical Examination
    - PET
    - CBT
    - Merit List
    - Cut Off
    - Shortlist
    - Application Status
    - City Intimation
    - Call Letter
    - Corrigendum
    - Scholarship
    - Tender

    Ignore completely if the change is only:

    - Visitor counter
    - IP address
    - Server name
    - Captcha
    - Accessibility text
    - Footer
    - Copyright
    - CSS
    - JavaScript
    - HTML fragments
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
    - Duplicate unchanged content
    - Commercial advertisements
    - Generic buttons such as:
    - Click Here
    - Download
    - Login
    - View
    - PDF

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
    "watch_uuid": "{{watch_uuid}}",
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
        "raw_explanation": ""
        }
    ]
    }

    ==================================================
    MULTIPLE NOTIFICATIONS
    ==================================================

    Return ONE object inside "items" for EACH distinct notification.

    Examples:

    Correct:

    Answer Key
    Call Letter
    Result

    ↓

    Three separate items.

    Do NOT merge unrelated notifications.

    However, language variants of the SAME notification (English, Hindi, Marathi, Tamil, etc.) must be treated as ONE notification.

    If uncertain whether two pieces represent different notifications, prefer separate items.

    Never create an item for content that appears only in diff_removed.

    Example

    diff_added:
    + CEN 05/2025 Answer Key

    diff_removed:
    + CEN 09/2025 Application Status
    + CEN 04/2025 Document Verification

    Correct Output:
    1 item

    CEN 05/2025

    Incorrect Output:
    3 items
    ==================================================
    FIELD RULES
    ==================================================
    title

    Generate a human-friendly, SEO-friendly title that accurately describes the notification.

    Purpose:
    - This is the primary title shown to users.
    - This title will also be used to generate the page slug.
    - It should match how people naturally search on Google.
    - Prefer readability over copying the official title word-for-word.

    Rules:
    - Preserve all important identifying information.
    - Keep official identifiers whenever they uniquely identify the notification (CEN, Advertisement No., Notification No., Recruitment No., etc.).
    - Include the organization or recruiting body when available.
    - Include the examination, recruitment, post, scheme, or subject.
    - Include the notification type (Notification, Recruitment, Result, Admit Card, Answer Key, Merit List, Syllabus, Vacancy, etc.).
    - Include the year when explicitly available.
    - Reorder words to improve readability.
    - Remove redundant legal or administrative wording that does not help identify the notification.
    - Remove phrases such as:
    - Regarding...
    - In reference to...
    - Notice for...
    - Result of...
    - Held on...
    - Dated...
    - Computer Based Test
    - Preliminary Examination
    - Main Examination
    - Written Examination
    - Phase-I
    - Stage-I
    - Stage-II
    - Subject to...
    when they do not help users identify the notification.
    - Never invent departments, posts, years, numbers, stages, or keywords.
    - Never change official reference numbers.
    - Keep the title concise (typically 40–80 characters).
    - Write in Title Case.
    - The same notification should always generate the same title.

    Examples

    Official:
    Result of Stage-I Preliminary Examination (Computer Based Test) of Junior Judicial Assistant / Restorer (Open) Examination – 2026

    Output:
    Delhi High Court Junior Judicial Assistant Result 2026

    Official:
    CEN No. 02/2025 (NTPC) - Call Letter for Document Verification

    Output:
    RRB NTPC CEN 02/2025 Document Verification Call Letter

    Official:
    Notice regarding release of SSC GD Constable Examination Result 2026

    Output:
    SSC GD Constable Result 2026

    Official:
    Advertisement No. 05/2026 Recruitment of Assistant Engineer (Civil)

    Output:
    Assistant Engineer (Civil) Recruitment Advertisement No. 05/2026

    Bad Examples:
    - Latest Government Job
    - New Notification
    - Click Here
    - Download PDF
    - Important Notice
    - Notification Regarding...
----------------------------------
    summary

    Write 2–3 simple sentences describing:

    - what has changed
    - what candidates should do next

    Do not exaggerate.

    Do not add information not present.

    ----------------------------------

    source_url

    Always use the provided Website URL exactly.

    ----------------------------------

    body

    Use the Website Name.

    Do not infer another organization from the page.

    ----------------------------------

    department

    Only infer when obvious.

    Example:

    Railway Recruitment Board

    ↓

    Ministry of Railways

    If uncertain, use the same value as body.

    ----------------------------------

    category

    Must be EXACTLY one of:

    Job
    Result
    Admit Card
    Answer Key
    Syllabus
    Admission
    Notice
    Scholarship
    Tender

    Never create any other category name.

    Use these deterministic mappings:

    - recruitment and vacancy advertisements = Job
    - merit list, shortlist, cut off, selected candidate, supplementary result, and application status = Result
    - generic notices, corrigendum, OTR, and exam calendar = Notice
    - scholarship announcements = Scholarship

    Labels such as Merit List, Shortlist, Cut Off, Application Status, Corrigendum, and Recruitment Advertisement must appear only in notification_type, not in category.

    ----------------------------------

    original_title

    Store the official title exactly as it appears on the source website.

    Purpose:

    Preserve the original wording published by the authority.
    This is used for verification and source reference.
    Users can search this exact text on the official page (Ctrl+F) and find the notification.
    Do NOT rewrite, shorten, or optimize it.
    Preserve capitalization, punctuation, reference numbers, abbreviations, stages, and examination names exactly.
    Never translate.
    Never remove words.
    Never add words.
    Never normalize spacing except trimming leading/trailing whitespace.
    If multiple headings exist, use the primary notification heading.

    Example

    Official Page

    Result of Stage-I Preliminary Examination (Computer Based Test) of Junior Judicial Assistant / Restorer (Open) Examination – 2026

    Output

    Result of Stage-I Preliminary Examination (Computer Based Test) of Junior Judicial Assistant / Restorer (Open) Examination – 2026
    ----------------------------------

    notification_type

    Choose the most appropriate value.

    Examples include:

    Recruitment Advertisement
    Result
    Answer Key
    Objection Notice
    Call Letter
    Interview Schedule
    Exam Schedule
    Application Status
    Document Verification
    Medical Examination
    PET
    CBT
    City Intimation
    Merit List
    Cut Off
    Shortlist
    Corrigendum
    Tender
    Other

    ----------------------------------

    notification_date

    Use the date explicitly stated.

    Return as:

    YYYY-MM-DD

    If no notification date exists, use Detected At and mention this in raw_explanation.

    ----------------------------------

    new_or_updated

    Return "New" only when the notification appears in diff_added and there is
    no matching notification in diff_removed.

    Return "Updated" only when:

    1. The same notification appears in BOTH diff_added and diff_removed.
    2. The content has materially changed
    (title, date, status, PDF, result, notice, advertisement,
    corrigendum, or notification text).

    If the matching content is identical or nearly identical,
    DO NOT classify it as Updated.

    Instead, classify it as New and reduce confidence,
    or mention in raw_explanation that the change could not be confirmed.

    Never assume Updated solely because the notification
    appears in both inputs.

    Examples of Updated:

    Old:
    Result published on 10 July

    New:
    Result revised on 12 July

    Old:
    Admit Card Notice

    New:
    Revised Admit Card Notice

    Examples of NOT Updated:

    diff_added:
    CEN 05/2025

    diff_removed:
    CEN 09/2025

    Result:
    CEN 05/2025 = New

    Ignore CEN 09/2025 completely.

    ----------------------------------

    confidence

    95–100

    Official notification with complete and unambiguous information.

    80–94

    Clearly relevant with minor inference.

    60–79

    Relevant but partially incomplete or ambiguous.

    Below 60

    Uncertain.
    Requires manual review.

    ----------------------------------

    raw_explanation

    Internal note only.

    Explain:

    - any inference made
    - whether notification_date came from Detected At
    - why confidence was reduced
    - whether content was partially truncated

    Keep it concise.

    ==================================================
    FINAL RULES
    ==================================================

    - Never fabricate facts.
    - Never invent dates.
    - Never invent notification numbers.
    - Never merge unrelated notifications.
    - Never discard a valid notification because another one appears more important.
    - Preserve official titles whenever possible.
    - Category must be exactly one of: Job, Result, Admit Card, Answer Key, Syllabus, Admission, Notice, Scholarship, Tender.
    - Never create new category names.
    - Return ONLY valid JSON.
    ==================================================
    MOST IMPORTANT RULE
    ==================================================

    A notification MUST originate from diff_added.

    If a notification is not present in diff_added, it MUST NOT appear in the output.

    The only exception is when diff_added is empty, in which case use diff.
    `
}

/**
 * Safely download a PDF file and extract plain text content.
 * Returns { success: true, text } or { success: false, error }.
 */
export async function downloadAndExtractPdfText(pdfUrl) {
    try {
        console.log(`📥 [PDF Fetch] Downloading PDF from: ${pdfUrl}`);
        const response = await axios.get(pdfUrl, {
            responseType: "arraybuffer",
            timeout: 15000, // 15 seconds timeout
            maxContentLength: 10 * 1024 * 1024, // Maximum 10MB file size limit
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) RojgaarSuchnaBot/3.0",
            },
        });

        const buffer = Buffer.from(response.data);
        const pdfModule = await import("pdf-parse");
        const pdfParse = pdfModule.default || pdfModule;
        const parsed = await pdfParse(buffer);
        const extractedText = (parsed.text || "").trim();

        if (!extractedText) {
            return { success: false, error: "Extracted PDF text is empty (scanned image PDF)" };
        }

        console.log(`✅ [PDF Fetch] Successfully extracted ${extractedText.length} characters from PDF.`);
        return { success: true, text: extractedText };
    } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`⚠️ [PDF Fetch Warning] Failed to download or parse PDF (${pdfUrl}): ${errorMsg}`);
        return { success: false, error: errorMsg };
    }
}

/**
 * Build Pass 2 AI Prompt when PDF text is available.
 * PDF content is treated as authoritative over webpage metadata.
 */
function buildPass2Prompt(pass1Item, pdfText) {
    return `
You are the content refinement engine for "Rojgaar Suchna".
We have already extracted preliminary notification data from a website change (Pass 1).
Now, we have extracted the FULL TEXT of the official PDF document related to this notification.

==================================================
PASS 1 EXTRACTED ITEM
==================================================
${JSON.stringify(pass1Item, null, 2)}

==================================================
OFFICIAL PDF CONTENT (AUTHORITATIVE)
==================================================
${pdfText.slice(0, 15000)}

==================================================
INSTRUCTIONS
==================================================
1. Treat the OFFICIAL PDF CONTENT as authoritative.
2. Refine the title, summary, department, body, and notification_date based on the official PDF text.
3. Keep the category strictly one of: Job, Result, Admit Card, Answer Key, Syllabus, Admission, Notice, Scholarship, Tender.
4. Return ONLY valid JSON in the exact same format:

{
    "title": "Refined Title Case Title",
    "original_title": "${pass1Item.original_title || ""}",
    "summary": "Updated summary from PDF...",
    "source_url": "${pass1Item.source_url || ""}",
    "department": "Ministry/Department Name",
    "body": "Detailed notification body",
    "category": "${pass1Item.category || "Job"}",
    "notification_type": "${pass1Item.notification_type || "Recruitment Advertisement"}",
    "notification_date": "YYYY-MM-DD",
    "new_or_updated": "${pass1Item.new_or_updated || "New"}",
    "confidence": 95,
    "raw_explanation": "Refined using Pass 2 PDF text extraction."
}
`;
}

/**
 * Strict safety guard before publishing any notification.
 * Returns true if notification meets all quality & confidence criteria.
 */
export function safeToPublish(item) {
    if (!item) return false;
    if (item.relevant === false) return false;
    if (item.is_duplicate === true) return false;
    if (item.pdf_download_failed === true) return false;
    if (typeof item.confidence === "number" && item.confidence < 70) return false;
    if (!item.title || !item.category || !item.source_url) return false;
    return true;
}

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

/**
 * Core V3 Webhook Processing Engine (2-Pass Adaptive AI Pipeline).
 */
export const processJob = async (payload) => {
    try {
        console.log(`🚀 [V3 Pipeline] Processing job for Watch: ${payload.watch_title || payload.watch_uuid}`);

        // Step 1: Clean HTML snapshot if provided to optimize AI context
        const cleanedHtml = cleanHtmlSnapshot(payload.snapshot_html || payload.html, payload.watch_url);
        const enrichedPayload = {
            ...payload,
            snapshot_html: cleanedHtml,
        };

        // Step 2: Pass 1 AI Analysis (Webpage change + HTML analysis)
        const promptPass1 = buildPrompt(enrichedPayload);
        const modelName = getTextModel();
        
        console.log(`🤖 [Pass 1 AI] Sending prompt using model: ${modelName}`);
        const pass1Result = await callTextLlm(promptPass1, modelName);
        
        let data;
        try {
            // Clean markdown blocks if present in raw response
            const cleanedRaw = (pass1Result.raw || "")
                .replace(/```json/gi, "")
                .replace(/```/g, "")
                .trim();
            data = JSON.parse(cleanedRaw);
        } catch (jsonErr) {
            console.error(`❌ [JSON Parse Error] AI response was not valid JSON: ${pass1Result.raw}`);
            throw new Error(`AI returned invalid JSON: ${jsonErr.message}`);
        }

        // Step 3: Fast exit if change is noise or irrelevant
        if (!data || !data.relevant || !Array.isArray(data.items) || data.items.length === 0) {
            console.log(`ℹ️ [V3 Pipeline] Event ignored. Reason: ${data?.reason || "Not relevant recruitment change"}`);
            return { processed: true, relevant: false, reason: data?.reason };
        }

        console.log(`📌 [Pass 1 AI] Found ${data.items.length} potential notification(s).`);

        // Step 4: Process each notification item (Pass 2 PDF Fallback & Publishing)
        for (let item of data.items) {
            // Check if PDF url exists and backend fetch is required
            if (item.pdf_url && item.pdf_needs_backend_fetch) {
                console.log(`📄 [PDF Fallback] Item requires backend PDF extraction: ${item.pdf_url}`);
                const pdfResult = await downloadAndExtractPdfText(item.pdf_url);

                if (pdfResult.success) {
                    // Pass 2 AI call to refine content using official PDF text
                    const promptPass2 = buildPass2Prompt(item, pdfResult.text);
                    console.log(`🤖 [Pass 2 AI] Refining item with official PDF content...`);
                    const pass2Response = await callTextLlm(promptPass2, modelName);
                    
                    try {
                        const cleanedPass2Raw = (pass2Response.raw || "")
                            .replace(/```json/gi, "")
                            .replace(/```/g, "")
                            .trim();
                        const pass2RefinedItem = JSON.parse(cleanedPass2Raw);
                        
                        // Merge Pass 2 refinements into item
                        item = {
                            ...item,
                            ...pass2RefinedItem,
                            pdf_url: item.pdf_url, // keep original PDF link
                        };
                        console.log(`✨ [Pass 2 AI] Item successfully refined using official PDF!`);
                    } catch (p2Err) {
                        console.warn(`⚠️ [Pass 2 Warning] Could not parse Pass 2 JSON response, falling back to Pass 1 item.`);
                    }
                } else {
                    // PDF download/parsing failed: mark for review instead of publishing incomplete blog
                    item.pdf_download_failed = true;
                    item.confidence = Math.min(item.confidence || 50, 55);
                    item.raw_explanation = `${item.raw_explanation || ""} [PDF Download Failed: ${pdfResult.error}]`.trim();
                }
            }

            // Step 5: Normalize category & build deduplication hash
            const normalizedItem = normalizeNotificationItem(item);
            const dedupeHash = generateHash(normalizedItem, data.watch_uuid);

            // Step 6: Deduplication Check in Database
            const existingNotification = await LatestNotification.findOne({ dedupe_hash: dedupeHash });
            if (existingNotification) {
                console.log(`🔁 [Deduplication] Notification already exists in DB: "${normalizedItem.title}"`);
                normalizedItem.is_duplicate = true;
                continue;
            }

            // Step 7: Check safeToPublish guard
            const isPublishable = safeToPublish(normalizedItem);
            const baseSlug = buildSlug(normalizedItem);
            const slug = await generateUniqueSlug(baseSlug, LatestNotification);

            // Step 8: Save to Database
            const savedDoc = await LatestNotification.create({
                watch_uuid: data.watch_uuid,
                title: normalizedItem.title,
                original_title: normalizedItem.original_title || item.original_title || normalizedItem.title,
                slug,
                summary: normalizedItem.summary,
                source_url: normalizedItem.source_url || payload.watch_url,
                pdf_url: normalizedItem.pdf_url || null,
                department: normalizedItem.department || payload.watch_title,
                body: normalizedItem.body || normalizedItem.summary,
                category: normalizedItem.category,
                notification_type: normalizedItem.notification_type || "Notice",
                notification_date: normalizedItem.notification_date || new Date().toISOString().split("T")[0],
                new_or_updated: normalizedItem.new_or_updated || "New",
                publish: isPublishable,
                status: isPublishable ? "published" : "needs_review",
                dedupe_hash: dedupeHash,
                ai: {
                    confidence: normalizedItem.confidence || 80,
                    explanation: normalizedItem.raw_explanation || "",
                    model: modelName,
                },
                webhook_payload: payload,
                ai_response: data,
            });

            console.log(`✅ [Database Saved] Notification stored with status "${savedDoc.status}": "${savedDoc.title}"`);
        }

        return { processed: true, relevant: true };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`❌ [V3 Pipeline Error] AI Processing failed: ${message}`);
        throw new Error(`AI processing failed: ${message}`);
    }
};

