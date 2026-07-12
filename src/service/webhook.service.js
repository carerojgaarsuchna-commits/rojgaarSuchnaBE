import { openRouterAPI } from "./ai-api/openRouterAPI.js";
import crypto from "crypto";
import { LatestNotification } from "../models/LatestNotification.js"
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

    Newly Added Content (Primary Source):
    ${diff_added}

    Removed Content (Reference Only):
    ${diff_removed}

    Full Diff (Use ONLY if diff_added is empty):
    ${diff}

    ==================================================
    GENERAL RULES
    ==================================================

    - Use diff_added as the primary source of truth.
    - Use diff only if diff_added is empty.
    - Use diff_removed only to determine whether an existing notification was updated.
    - Never invent, complete, or assume missing information.
    - The Website Name and Website URL are authoritative. Use them directly whenever possible.
    - Strip HTML, CSS, JavaScript fragments and formatting artifacts mentally before analysis.
    - Return ONLY valid JSON.
    - Do NOT return markdown.
    - Do NOT explain your reasoning outside the JSON.

    ==================================================
    STEP 1 — RELEVANCE CHECK
    ==================================================

    Determine whether the content contains one or more genuine recruitment-related notifications.

    Relevant examples include:

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

    Job Vacancy
    Result
    Admit Card
    Answer Key
    Admission
    Syllabus
    Notice
    Tender
    Other

    Choose the most specific option.

    Do not overuse "Notice".

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

    Return:

    New

    or

    Updated

    Return Updated ONLY when diff_removed clearly shows the SAME notification being revised.

    Examples:

    Updated exam date

    Updated result

    Corrected PDF

    Changed instructions

    Otherwise return New.

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
    - Return ONLY valid JSON.
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

            const dedupeHash = generateHash(item, data.watch_uuid);

            const existing = await LatestNotification.findOne({
                dedupe_hash: dedupeHash
            });

            if (existing) {
                console.log("Duplicate notification:", item.title);
                continue;
            }

            await LatestNotification.create({
                watch_uuid: data.watch_uuid,

                title: item.title,
                summary: item.summary,

                source_url: item.source_url,

                department: item.department,
                body: item.body,

                category: item.category,
                notification_type: item.notification_type,

                notification_date: item.notification_date,

                new_or_updated: item.new_or_updated,

                publish: data.publish ?? true,

                dedupe_hash: dedupeHash,

                ai: {
                    confidence: item.confidence,
                    explanation: item.raw_explanation,
                    model: process.env.OPENROUTER_MODEL,
                },

                webhook_payload: payload,

                ai_response: data,
            });

            console.log("Saved:", item.title);
        }

        return true;

    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);

        console.error(message);

        throw new Error(`AI processing failed: ${message}`);
    }
};
