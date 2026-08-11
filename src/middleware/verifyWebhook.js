function parseWebhook(body) {
    if (body.secret) {
        return body;
    }

    if (!body.message) {
        throw new Error("Missing webhook message");
    }

    let msg = body.message;

    // remove HTML entities
    msg = msg.replace(/&nbsp;/g, "");
    msg = msg.replace(/<[^>]*>/g, "");

    // convert \u0026
    msg = msg.replace(/\\u0026/g, "&");

    return JSON.parse(msg);
}

/**
 * Strip ChangeDetection markup (**bold**, (changed), (into), +/- lines)
 * to get the raw content that actually changed.
 */
function stripDiffMarkup(diff) {
    return diff
        .replace(/\*\*/g, " ")
        .replace(/^\s*\(changed\)\s*/gm, "")
        .replace(/^\s*\(into\)\s*/gm, "")
        .replace(/^\s*[+\-]\s+/gm, "")
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * Returns true if the stripped diff is purely dynamic noise:
 * - Only timestamps / clock changes
 * - Only IP address changes
 * - Only countdown timer ticks (digits + sec/min/hour)
 * - Only load-balancer/host name changes
 */
function isPureDynamicNoise(strippedDiff) {
    const lower = strippedDiff.toLowerCase();

    // Check 1: Contains meaningful recruitment/content keywords → NOT noise
    const contentKeywords = [
        "recruitment", "vacancy", "advertisement", "advt", "notification",
        "apply", "result", "admit", "syllabus", "tender", "scholarship",
        "admission", "counselling", "selection", "interview", "exam",
        "post", "job", "allotment letter", "merit", "cutoff",
    ];
    if (contentKeywords.some((kw) => lower.includes(kw))) {
        return false; // Has real content — not noise
    }

    // Check 2: Remove all time/date/IP/counter patterns and see what's left
    const withoutDynamic = strippedDiff
        .replace(/\b\d{1,2}:\d{2}(:\d{2})?\s*(am|pm)?\b/gi, "")  // time: 05:40:14 PM
        .replace(/\b\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/gi, "") // date
        .replace(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi, "")
        .replace(/\d+\s*(sec|min|hour|day|hrs?)\b/gi, "")          // countdown: 31sec
        .replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, "")  // IP: 10.249.170.71
        .replace(/\b[A-Z0-9\-]{6,}\b/g, "")                        // hostnames: HDH2DEDP-D4
        .replace(/\s+/g, " ")
        .trim();

    // If fewer than 15 meaningful characters remain → pure dynamic noise
    return withoutDynamic.length < 15;
}

function isValidChangeDetection(payload) {
    const diff = String(payload.diff || "");

    // 1. Empty diff
    if (!diff.trim()) {
        return { valid: false, reason: "Empty diff" };
    }

    // 2. Diff too small (raw)
    if (diff.trim().length < 25) {
        return { valid: false, reason: "Diff is too small" };
    }

    // 3. Strip ChangeDetection markup and check again
    const stripped = stripDiffMarkup(diff);
    if (stripped.length < 15) {
        return { valid: false, reason: "Diff contains only markup — no real content change" };
    }

    // 4. Pure dynamic noise (clocks, IP, countdown timers, hostnames)
    if (isPureDynamicNoise(stripped)) {
        return {
            valid: false,
            reason: "Diff is pure dynamic noise (timestamps/IP/timer changes) — no content change"
        };
    }

    // Passed all checks
    return { valid: true };
}


const verifyWebhook = (req, res, next) => {

    try {
        req.body = parseWebhook(req.body);

        const secret = req.body.secret;

        if (!secret) {
            return res.status(401).json({
                sucess: false,
                message: "Webhook secret missing"

            });
        }
        const mySecret = process.env.WEBHOOK_SECRET;
        if (secret !== mySecret) {
            return res.status(401).json({
                success: false,
                message: "Invalid secret"
            });
        }
        const validation = isValidChangeDetection(req.body)
        if (!validation.valid) {
            console.error('validation error:', validation.reason)
            return res.status(200).json({
                success: true,
                message: validation.reason
            })
        }

        next();

    } catch (err) {
        return res.status(500).json({
            sucess: false,
            message: err.message
        });
    }
}
export default verifyWebhook;


