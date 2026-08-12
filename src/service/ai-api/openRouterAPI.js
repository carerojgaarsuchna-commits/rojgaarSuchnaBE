import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function openRouterAPI(prompt, model) {
    const apiKey = process.env.OPENROUTER_API_KEY?.trim();

    if (!apiKey) {
        throw new Error("OPENROUTER_API_KEY is not configured");
    }

    const apiUrl = "https://openrouter.ai/api/v1/chat/completions";
    model = model || process.env.OPENROUTER_MODEL || "";

    const headers = {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
    };

    const systemPrompt = `
    You are the structured information extraction engine for Rojgaar Suchna.

    Extract recruitment-related information from official Indian government website changes.

    Always:
    - return valid JSON only;
    - follow the user's schema exactly;
    - never hallucinate or invent facts;
    - preserve official wording whenever possible.
    `;

    const response = await fetch(apiUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({
            model,
            messages: [
                {
                    role: "system",
                    content: systemPrompt
                },
                {
                    role: "user",
                    content: prompt
                }
            ]
        })
    });

    const result = await response.json();

    if (!response.ok) {
        console.error('Ai Error ',result?.error?.message);
        throw new Error(result?.error?.message || "OpenRouter error");
    }
    return result?.choices?.[0]?.message?.content;
}

/**
 * Call OpenRouter with a vision-capable messages array.
 * Exported so aiProvider.js can use it directly on the openrouter path.
 * @param {Array}  messages  — OpenRouter messages array
 * @param {string} model     — model identifier
 * @returns {Promise<{ raw: string, latencyMs: number }>}
 */
export async function callVisionLlmRaw(messages, model) {
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
