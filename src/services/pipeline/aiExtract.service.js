/**
 * aiExtract.service.js
 * Stage 5a — AI extraction service.
 *
 * TEXT path:  extracted text + matched metadata → one LLM call → structured JSON
 * VISION path: PDF pages as base64 images → vision-capable LLM → structured JSON
 *
 * Exception budget (per plan):
 *  - matching LLM:        max 1 (handled in matching.service.js)
 *  - JSON reprompt:       max 1 (handled here)
 *  - validation reprompt: max 1 (handled in validation.service.js)
 *  - vision escalation:   max 1 (handled here)
 *
 * The LLM is a document analyst only.
 * It never generates URLs, PDF paths, or database IDs.
 */

import { openRouterAPI } from "../../service/ai-api/openRouterAPI.js";
import { ALLOWED_NOTIFICATION_CATEGORIES } from "../../utils/notificationCategory.js";

// ─── Models ───────────────────────────────────────────────────────────────────

const TEXT_MODEL = process.env.OPENROUTER_MODEL || "google/gemini-2.0-flash-001";
const VISION_MODEL =
  process.env.OPENROUTER_VISION_MODEL ||
  process.env.OPENROUTER_MODEL ||
  "google/gemini-2.0-flash-001";

// ─── Prompt builders ──────────────────────────────────────────────────────────

/**
 * Build the system prompt for document analysis.
 * Injection-resistant: content is in the user turn, not the system prompt.
 */
function buildSystemPrompt() {
  return `You are a structured data extraction engine for Rojgaar Suchna, an Indian government job notification portal.

Your ONLY job is to analyze the provided official government notification document and extract structured information from it.

STRICT RULES:
- Return ONLY valid JSON matching the schema below. No prose, no markdown, no code fences.
- Never invent or hallucinate any field. If a value is not clearly stated in the document, use null.
- Never generate URLs, file paths, or advertisement numbers not present in the document.
- Use the exact official wording for titles and organization names.
- Dates must be in YYYY-MM-DD format. If only month and year are given, use the first day of the month.
- total_posts must be a number (integer). If not mentioned, use null.
- article_html must be well-structured HTML (h2, p, ul/li, table) — minimum 300 characters.

CATEGORIES (use exactly one):
${ALLOWED_NOTIFICATION_CATEGORIES.join(", ")}

NOTIFICATION TYPES (use exactly one):
New Recruitment, Re-Advertisement, Corrigendum, Result, Admit Card, Answer Key, Syllabus, Admission, Scholarship, Tender, Notice, Other

REQUIRED JSON SCHEMA:
{
  "title": "short SEO-friendly title (English)",
  "original_title": "exact official title from document",
  "advertisement_no": "exact ad number or null",
  "category": "one of the categories above",
  "notification_type": "one of the notification types above",
  "notification_date": "YYYY-MM-DD or null",
  "department": "ministry or department name",
  "body": "recruiting body / organization name",
  "total_posts": number or null,
  "qualification": "minimum qualification or null",
  "salary": "pay scale/CTC or null",
  "age_limit": "age range or null",
  "last_date": "YYYY-MM-DD or null",
  "important_dates": [{"label": "...", "date": "..."}],
  "apply_link": null,
  "summary": "2-3 sentence summary for candidates",
  "article_html": "<h2>...</h2><p>...</p>...",
  "tags": ["tag1", "tag2"]
}`;
}

/**
 * Build the user prompt for the text path.
 * @param {string} extractedText
 * @param {{ matchedTitle:string, watchTitle:string, watchUrl:string }} meta
 * @returns {string}
 */
function buildTextPrompt(extractedText, meta) {
  const textSlice = extractedText.slice(0, 12000); // Guard against huge PDFs

  return `NOTIFICATION CONTEXT:
Site: ${meta.watchTitle || "Unknown"}
URL: ${meta.watchUrl || "Unknown"}
Matched notification title: ${meta.matchedTitle || "Unknown"}

DOCUMENT TEXT (extracted from official PDF):
---
${textSlice}
---

Extract structured data from the above document and return JSON only.`;
}

/**
 * Build the user prompt for the vision path.
 * @param {string} pdfBase64   — base64-encoded PDF (or first-page image)
 * @param {{ matchedTitle:string, watchTitle:string, watchUrl:string }} meta
 * @returns {Array} — messages array for vision model
 */
function buildVisionMessages(pdfBase64, meta) {
  return [
    {
      role: "system",
      content: buildSystemPrompt(),
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: `NOTIFICATION CONTEXT:
Site: ${meta.watchTitle || "Unknown"}
URL: ${meta.watchUrl || "Unknown"}
Matched notification title: ${meta.matchedTitle || "Unknown"}

The PDF could not be read as text. Analyze the document image(s) below and return JSON only.`,
        },
        {
          type: "image_url",
          image_url: {
            url: `data:application/pdf;base64,${pdfBase64}`,
          },
        },
      ],
    },
  ];
}

// ─── JSON parsing ─────────────────────────────────────────────────────────────

/**
 * Parse JSON from LLM response string.
 * Handles responses wrapped in markdown code fences.
 * @param {string} raw
 * @returns {{ ok:boolean, data?:object, error?:string }}
 */
function parseJsonResponse(raw = "") {
  // Strip markdown code fences if present
  const stripped = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();

  try {
    return { ok: true, data: JSON.parse(stripped) };
  } catch (err) {
    return { ok: false, error: `JSON parse failed: ${err.message}` };
  }
}

// ─── OpenRouter wrapper ───────────────────────────────────────────────────────

/**
 * Call OpenRouter with a plain text prompt and return raw string.
 * @param {string} prompt
 * @param {string} model
 * @returns {Promise<{raw:string, latencyMs:number}>}
 */
async function callTextLlm(prompt, model) {
  const start = Date.now();
  // openRouterAPI is a simple fetch wrapper — reuse as-is
  const raw = await openRouterAPI(prompt, model);
  return { raw: raw || "", latencyMs: Date.now() - start };
}

/**
 * Call OpenRouter for vision input.
 * Uses native fetch (same pattern as openRouterAPI.js) so we can send image_url content.
 * @param {Array} messages
 * @param {string} model
 * @returns {Promise<{raw:string, latencyMs:number}>}
 */
async function callVisionLlm(messages, model) {
  const start = Date.now();
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();

  if (!apiKey) throw new Error("OPENROUTER_API_KEY not configured");

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, messages }),
  });

  const result = await response.json();

  if (!response.ok) {
    throw new Error(result?.error?.message || `OpenRouter vision error: ${response.status}`);
  }

  const raw = result?.choices?.[0]?.message?.content || "";
  return { raw, latencyMs: Date.now() - start };
}

// ─── Main exports ─────────────────────────────────────────────────────────────

/**
 * Run AI extraction on the text path.
 * Includes one JSON-reprompt if the first response is malformed.
 *
 * @param {{ extractedText:string, matchedTitle:string, watchTitle:string, watchUrl:string }} params
 * @returns {Promise<{ok:boolean, data?:object, raw?:string, latencyMs:number, model:string, exception_calls:number, error?:string}>}
 */
export async function extractWithTextLlm({ extractedText, matchedTitle, watchTitle, watchUrl }) {
  const model = TEXT_MODEL;
  const meta = { matchedTitle, watchTitle, watchUrl };
  const prompt = `${buildSystemPrompt()}\n\n${buildTextPrompt(extractedText, meta)}`;

  let exceptionCalls = 0;

  // First attempt
  const { raw, latencyMs } = await callTextLlm(prompt, model);
  const parsed = parseJsonResponse(raw);

  if (parsed.ok) {
    return { ok: true, data: parsed.data, raw, latencyMs, model, exception_calls: exceptionCalls };
  }

  // JSON reprompt (exception budget: max 1)
  exceptionCalls += 1;
  console.warn("[ai-extract] text JSON parse failed — reprompting (exception call 1)");

  const reprompt = `${prompt}\n\nYour previous response was not valid JSON. Return ONLY the raw JSON object, no text before or after.`;
  const retry = await callTextLlm(reprompt, model);
  const retryParsed = parseJsonResponse(retry.raw);

  return {
    ok: retryParsed.ok,
    data: retryParsed.data,
    raw: retry.raw,
    latencyMs: latencyMs + retry.latencyMs,
    model,
    exception_calls: exceptionCalls,
    error: retryParsed.ok ? undefined : retryParsed.error,
  };
}

/**
 * Run AI extraction on the vision path.
 * Includes one JSON-reprompt if the first response is malformed,
 * and falls back to text LLM if vision endpoint is unsupported or fails.
 *
 * @param {{ pdfBuffer:Buffer, matchedTitle:string, watchTitle:string, watchUrl:string, extractedText?:string }} params
 * @returns {Promise<{ok:boolean, data?:object, raw?:string, latencyMs:number, model:string, exception_calls:number, error?:string}>}
 */
export async function extractWithVisionLlm({ pdfBuffer, matchedTitle, watchTitle, watchUrl, extractedText = "" }) {
  const model = VISION_MODEL;
  const meta = { matchedTitle, watchTitle, watchUrl };
  const pdfBase64 = pdfBuffer.toString("base64");
  const messages = buildVisionMessages(pdfBase64, meta);

  let exceptionCalls = 0;

  try {
    // First attempt
    const { raw, latencyMs } = await callVisionLlm(messages, model);
    const parsed = parseJsonResponse(raw);

    if (parsed.ok) {
      return { ok: true, data: parsed.data, raw, latencyMs, model, exception_calls: exceptionCalls };
    }

    // JSON reprompt (exception budget: max 1)
    exceptionCalls += 1;
    console.warn("[ai-extract] vision JSON parse failed — reprompting (exception call 1)");

    const repromptMessages = [
      ...messages,
      { role: "assistant", content: raw },
      {
        role: "user",
        content:
          "Your previous response was not valid JSON. Return ONLY the raw JSON object, no text before or after.",
      },
    ];

    const retry = await callVisionLlm(repromptMessages, model);
    const retryParsed = parseJsonResponse(retry.raw);

    return {
      ok: retryParsed.ok,
      data: retryParsed.data,
      raw: retry.raw,
      latencyMs: latencyMs + retry.latencyMs,
      model,
      exception_calls: exceptionCalls,
      error: retryParsed.ok ? undefined : retryParsed.error,
    };
  } catch (visionErr) {
    console.warn(
      `[ai-extract] vision LLM failed (${visionErr.message}) — falling back to text path`
    );

    const fallbackText =
      extractedText.trim() ||
      `Official Notice Title: ${matchedTitle}\nOrganization: ${watchTitle}\nSource: ${watchUrl}`;

    return extractWithTextLlm({
      extractedText: fallbackText,
      matchedTitle,
      watchTitle,
      watchUrl,
    });
  }
}
