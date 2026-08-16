/**
 * googleGenAI.js
 * Google GenAI SDK wrapper for Rojgaar Suchna pipeline.
 *
 * Exposes two functions that match the same shape as the OpenRouter equivalents:
 *   callGoogleText(prompt, model)                        → { raw, latencyMs }
 *   callGoogleVision(pdfBase64, textPrompt, model)       → { raw, latencyMs }
 *
 * Google GenAI accepts PDF inlineData natively — no image-per-page conversion needed.
 * All calls are guarded by AI_TIMEOUT_MS to prevent worker slot exhaustion.
 */

import { GoogleGenAI } from "@google/genai";

const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS) || 30000;

function getClient() {
  const apiKey = process.env.GOOGLE_API_KEY?.trim();
  if (!apiKey) throw new Error("GOOGLE_API_KEY is not configured");
  return new GoogleGenAI({ apiKey });
}

/**
 * Race a promise against a hard deadline.
 * Rejects with a descriptive error when time runs out.
 */
function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`[AI Timeout] ${label} exceeded ${ms}ms deadline`)),
      ms
    );
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

/**
 * Call Google GenAI on the text path.
 * @param {string} prompt            — full prompt string (system + user combined)
 * @param {string} model             — e.g. "gemini-2.0-flash"
 * @param {string} [systemInstruction] — optional system instruction (if provided, prompt is user-only)
 * @returns {Promise<{ raw: string, latencyMs: number }>}
 */
export async function callGoogleText(prompt, model, systemInstruction) {
  const start = Date.now();
  const ai = getClient();

  const config = systemInstruction ? { systemInstruction } : undefined;

  const generatePromise = ai.models.generateContent({
    model,
    ...(config && { config }),
    contents: prompt,
  });

  const response = await withTimeout(
    generatePromise,
    AI_TIMEOUT_MS,
    `callGoogleText(${model})`
  );

  return {
    raw: response.text ?? "",
    latencyMs: Date.now() - start,
  };
}

/**
 * Call Google GenAI on the vision path.
 * Sends the PDF as inline base64 data alongside a text prompt.
 * @param {string} pdfBase64         — base64-encoded PDF buffer
 * @param {string} textPrompt        — the text portion of the user message
 * @param {string} model             — e.g. "gemini-2.0-flash"
 * @param {string} [systemInstruction] — system prompt (schema, rules). Required for correct output.
 * @returns {Promise<{ raw: string, latencyMs: number }>}
 */
export async function callGoogleVision(pdfBase64, textPrompt, model, systemInstruction) {
  const start = Date.now();
  const ai = getClient();

  // systemInstruction tells Gemini exactly what schema to return.
  // Without it the model ignores the schema and invents its own structure.
  const config = systemInstruction ? { systemInstruction } : undefined;

  const generatePromise = ai.models.generateContent({
    model,
    ...(config && { config }),
    contents: [
      {
        role: "user",
        parts: [
          {
            inlineData: {
              data: pdfBase64,
              mimeType: "application/pdf",
            },
          },
          { text: textPrompt },
        ],
      },
    ],
  });

  const response = await withTimeout(
    generatePromise,
    AI_TIMEOUT_MS,
    `callGoogleVision(${model})`
  );

  return {
    raw: response.text ?? "",
    latencyMs: Date.now() - start,
  };
}
