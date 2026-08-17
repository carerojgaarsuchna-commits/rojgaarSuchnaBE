/**
 * changedetection.service.js
 *
 * Fetches the latest HTML/text snapshot for a watch from the ChangeDetection.io API.
 * Used by the V3 pipeline (Step 1c) to get real page HTML so the AI can resolve
 * document hrefs (pdf_url) that are never included in the webhook diff payload.
 *
 * Env vars (all required for the fetch to run):
 *   CHANGEDETECTION_API_URL      - Base URL, e.g. https://changedetection-production-897b.up.railway.app
 *   CHANGEDETECTION_API_TOKEN    - x-api-key value from the ChangeDetection Settings tab
 *   PIPELINE_HTML_TIMEOUT_MS     - HTTP timeout in ms (default: 4000)
 */

import axios from "axios";

const CDIO_BASE_URL = (process.env.CHANGEDETECTION_API_URL || "").replace(/\/$/, "");
const CDIO_TOKEN    = process.env.CHANGEDETECTION_API_TOKEN || "";
const HTML_TIMEOUT  = Number(process.env.PIPELINE_HTML_TIMEOUT_MS) || 4000;

/**
 * Fetch the latest snapshot content for a given watch UUID.
 * Uses /history/latest - one HTTP call, no timestamp lookup needed.
 *
 * @param {string} watchUuid
 * @returns {Promise<string|null>}  Raw HTML/text string, or null on any failure
 */
export async function fetchWatchSnapshot(watchUuid) {
    // Guard: skip silently when env is not configured or uuid is missing
    if (!CDIO_BASE_URL || !CDIO_TOKEN || !watchUuid) {
        if (!CDIO_BASE_URL || !CDIO_TOKEN) {
            console.warn("⚠️ [CDIO] CHANGEDETECTION_API_URL or CHANGEDETECTION_API_TOKEN not set — skipping HTML snapshot fetch.");
        }
        return null;
    }

    const url = `${CDIO_BASE_URL}/api/v1/watch/${watchUuid}/history/latest`;

    try {
        console.log(`🌐 [CDIO] Fetching snapshot: ${url}`);

        const response = await axios.get(url, {
            headers: {
                "x-api-key": CDIO_TOKEN,
                "Accept": "text/html, text/plain, */*",
            },
            timeout: HTML_TIMEOUT,
            maxContentLength: 10 * 1024 * 1024, // 10 MB cap
            responseType: "text",               // prevent axios from auto-parsing HTML as JSON
            validateStatus: (s) => s >= 200 && s < 300,
        });

        const content = typeof response.data === "string" ? response.data : "";

        if (!content.trim()) {
            console.warn(`⚠️ [CDIO] Empty snapshot returned for watch: ${watchUuid}`);
            return null;
        }

        console.log(`✅ [CDIO] Snapshot fetched — ${content.length} chars for watch: ${watchUuid}`);
        return content;

    } catch (err) {
        const status = err.response?.status;
        const msg    = status
            ? `HTTP ${status}: ${err.response?.statusText || err.message}`
            : err.message;
        console.warn(`⚠️ [CDIO] Snapshot fetch failed for ${watchUuid}: ${msg}`);
        return null;
    }
}
