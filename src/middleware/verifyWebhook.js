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

function isValidChangeDetection(payload) {
    const diff = String(payload.diff || "");

    // 1. Empty diff
    if (!diff.trim()) {
        return {
            valid: false,
            reason: "Empty diff"
        };
    }

    // 2. Diff too small
    if (diff.trim().length < 25) {
        return {
            valid: false,
            reason: "Diff is too small"
        };
    }

    // Passed all checks
    return {
        valid: true
    };

};


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
            return res.status(200).json({
                sucess: true,
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


