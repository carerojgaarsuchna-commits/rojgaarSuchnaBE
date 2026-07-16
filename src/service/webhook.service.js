import { openRouterAPI } from "./ai-api/openRouterAPI.js";
import crypto from "crypto";
import { LatestNotification } from "../models/LatestNotification.js";
import {
    normalizeNotificationCategory,
} from "../utils/notificationCategory.js";
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
    console.log('diff_added----',diff_added);
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
        "notification_key": "",
        "title": "",
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

    notification_key

    Generate a short stable identifier using available information.

    Example:

    rrb-ranchi-cen-02-2025-dv-call-letter

    or

    ssc-gd-result-2026

    Use lowercase words separated by hyphens.

    Do not invent reference numbers.

    ----------------------------------

    title

    Preserve the official notification title as closely as possible.

    Keep:

    - CEN numbers
    - Advertisement numbers
    - Recruitment numbers
    - Official wording

    Only normalize obvious spacing or capitalization.

    Never rewrite the official title into your own wording.

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

    Return "New" when the notification originates from diff_added.

    Return "Updated" ONLY if BOTH of the following are true:

    1. The same notification exists in diff_added.
    2. A previous version of that SAME notification exists in diff_removed.

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

function generateHash(item, watch_uuid) {
    return crypto
        .createHash("sha256")
        .update(
            `${watch_uuid}|${item.title}|${item.notification_date}|${item.category}`
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

export const processJob = async (payload) => {
    try {
        const prompt = buildPrompt(payload);

        const aiResponse = await openRouterAPI(prompt);

        // aiResponse is a string
        const data = JSON.parse(aiResponse);

        if (!data.relevant) {
            console.log("Not relevant:", data.reason);
            return true;
        }

        for (const item of data.items) {
            const normalizedItem = normalizeNotificationItem(item);

            const dedupeHash = generateHash(normalizedItem, data.watch_uuid);

            const existing = await LatestNotification.findOne({
                dedupe_hash: dedupeHash
            });

            if (existing) {
                console.log("Duplicate notification:", normalizedItem.title);
                continue;
            }

            await LatestNotification.create({
                watch_uuid: data.watch_uuid,

                title: normalizedItem.title,
                summary: normalizedItem.summary,

                source_url: normalizedItem.source_url,

                department: normalizedItem.department,
                body: normalizedItem.body,

                category: normalizedItem.category,
                notification_type: normalizedItem.notification_type,

                notification_date: normalizedItem.notification_date,

                new_or_updated: normalizedItem.new_or_updated,

                publish: data.publish ?? true,

                dedupe_hash: dedupeHash,

                ai: {
                    confidence: normalizedItem.confidence,
                    explanation: normalizedItem.raw_explanation,
                    model: process.env.OPENROUTER_MODEL,
                },

                webhook_payload: payload,

                ai_response: data,
            });

            console.log("Saved:", normalizedItem.title);
        }

        return true;

    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);

        console.error(message);

        throw new Error(`AI processing failed: ${message}`);
    }
};

// export const processFailedJobs = async (payload) => {

// }
