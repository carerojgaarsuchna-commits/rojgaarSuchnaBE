import dotenv from "dotenv";

dotenv.config();

const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS) || 30000;

/**
 * Wrap a promise with a timeout using AbortController.
 * Throws a descriptive error when the deadline is exceeded.
 */
function withTimeout(promise, ms, label) {
    const controller = new AbortController();
    const timer = setTimeout(() => {
        controller.abort();
    }, ms);

    return Promise.race([
        promise,
        new Promise((_, reject) => {
            controller.signal.addEventListener("abort", () => {
                reject(new Error(`[AI Timeout] ${label} exceeded ${ms}ms deadline`));
            });
        }),
    ]).finally(() => clearTimeout(timer));
}

/**
 * Call OpenRouter text completions API.
 * Aborts with a hard timeout to prevent permanently occupying a BullMQ worker slot.
 */
export async function openRouterAPI(prompt, model) {
    const apiKey = process.env.OPENROUTER_API_KEY?.trim();

    if (!apiKey) {
        throw new Error("OPENROUTER_API_KEY is not configured");
    }

    const apiUrl = "https://openrouter.ai/api/v1/chat/completions";
    model = model || process.env.OPENROUTER_MODEL || "";

    const headers = {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
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

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

    try {
        const response = await fetch(apiUrl, {
            method: "POST",
            headers,
            signal: controller.signal,
            body: JSON.stringify({
                model,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: prompt },
                ],
            }),
        });

        const result = await response.json();

        if (!response.ok) {
            console.error("OpenRouter API error:", result?.error?.message);
            throw new Error(result?.error?.message || "OpenRouter error");
        }

        return result?.choices?.[0]?.message?.content;
    } catch (err) {
        if (err.name === "AbortError" || (err.message && err.message.includes("aborted"))) {
            throw new Error(`[AI Timeout] openRouterAPI exceeded ${AI_TIMEOUT_MS}ms deadline`);
        }
        throw err;
    } finally {
        clearTimeout(timer);
    }
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

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

    try {
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            signal: controller.signal,
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
    } catch (err) {
        if (err.name === "AbortError" || (err.message && err.message.includes("aborted"))) {
            throw new Error(`[AI Timeout] callVisionLlmRaw exceeded ${AI_TIMEOUT_MS}ms deadline`);
        }
        throw err;
    } finally {
        clearTimeout(timer);
    }
}
