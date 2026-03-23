import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function openRouterAPI(prompt) {
    console.log('--------prompt------------ai------')
    console.log(prompt)
    console.log('--------prompt------------ai------')
    const apiUrl = "https://openrouter.ai/api/v1/chat/completions";
    const model = process.env.OPENROUTER_MODEL || "stepfun/step-3.5-flash:free";

    const headers = {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json"
    };

    const systemPrompt = `
        You are an expert SEO content writer for an Indian government job portal.
        Write structured markdown content using:
        ### headings
        tables
        bullet lists
        numbered lists
        Use clear formatting and short paragraphs.
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
        throw new Error(result?.error?.message || "OpenRouter error");
    }
    console.log('result?.choices?.[0]?.message?', result?.choices?.[0]?.message)
    console.log('-result', result?.choices?.[0]?.message?.content);
    return result?.choices?.[0]?.message?.content;
}
