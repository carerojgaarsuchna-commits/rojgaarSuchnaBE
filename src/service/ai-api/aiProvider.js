/**
 * aiProvider.js
 * Single routing layer for all AI calls in the pipeline.
 *
 * Set AI_PROVIDER in your .env to switch providers without touching any other file:
 *   AI_PROVIDER=openrouter   →  OpenRouter (default)
 *   AI_PROVIDER=google       →  Google GenAI
 *
 * Both paths return: { raw: string, latencyMs: number }
 *
 * Import from here in aiExtract.service.js — never import OpenRouter or Google directly.
 */

import { openRouterAPI, callVisionLlmRaw } from "./openRouterAPI.js";
import { callGoogleText, callGoogleVision } from "./googleGenAI.js";

const PROVIDER = (process.env.AI_PROVIDER || "openrouter").toLowerCase().trim();

/**
 * Get the configured text model for the active provider.
 * @returns {string}
 */
export function getTextModel() {
  if (PROVIDER === "google") {
    return process.env.GOOGLE_MODEL || "gemini-2.0-flash";
  }
  return process.env.OPENROUTER_MODEL || "google/gemini-2.0-flash-001";
}

/**
 * Get the configured vision model for the active provider.
 * @returns {string}
 */
export function getVisionModel() {
  if (PROVIDER === "google") {
    return process.env.GOOGLE_VISION_MODEL || process.env.GOOGLE_MODEL || "gemini-2.0-flash";
  }
  return (
    process.env.OPENROUTER_VISION_MODEL ||
    process.env.OPENROUTER_MODEL ||
    "google/gemini-2.0-flash-001"
  );
}

/**
 * Call the text LLM (routes to active provider).
 * @param {string} prompt   — full combined prompt string
 * @param {string} model    — model identifier
 * @returns {Promise<{ raw: string, latencyMs: number }>}
 */
export async function callTextLlm(prompt, model) {
  if (PROVIDER === "google") {
    return callGoogleText(prompt, model);
  }

  // OpenRouter path
  const start = Date.now();
  const raw = await openRouterAPI(prompt, model);
  return { raw: raw || "", latencyMs: Date.now() - start };
}

/**
 * Call the vision LLM (routes to active provider).
 *
 * Accepts OpenRouter-style messages array — the Google path extracts
 * the PDF base64 and text parts automatically.
 *
 * @param {Array}  messages  — OpenRouter messages array (system + user with image_url)
 * @param {string} model     — model identifier
 * @returns {Promise<{ raw: string, latencyMs: number }>}
 */
export async function callVisionLlm(messages, model) {
  if (PROVIDER === "google") {
    // Extract system prompt — Gemini requires it via systemInstruction to enforce JSON schema
    const systemMsg = messages.find((m) => m.role === "system");
    const systemInstruction = typeof systemMsg?.content === "string"
      ? systemMsg.content
      : undefined;

    // Extract PDF base64 and text from the OpenRouter-style messages structure
    const userContent = messages.find((m) => m.role === "user")?.content || [];
    const imagePart = Array.isArray(userContent)
      ? userContent.find((c) => c.type === "image_url")
      : null;
    const textPart = Array.isArray(userContent)
      ? userContent.find((c) => c.type === "text")
      : null;

    const pdfBase64 = imagePart?.image_url?.url?.replace(
      "data:application/pdf;base64,",
      ""
    ) || "";
    const textPrompt = textPart?.text || "";

    return callGoogleVision(pdfBase64, textPrompt, model, systemInstruction);
  }

  // OpenRouter path
  return callVisionLlmRaw(messages, model);
}
