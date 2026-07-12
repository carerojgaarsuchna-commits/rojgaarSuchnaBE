function isValidChangeDetection (payload){
    const diff = String(payload.diff || "");
    const snapshot = String(payload.current_snapshot || "");

    const text = `${diff} ${snapshot}`.toLowerCase();

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

    // 3. Ignore common useless changes
    const ignoreWords = [
        "total visits",
        "visitor count",
        "support id",
        "ip address",
        "host name",
        "screen reader",
        "skip to main content",
        "font size",
        "color contrast",
        "accessibility",
        "captcha",
        "human visitor",
        "audio is not supported"
    ];

    for (const word of ignoreWords) {

        if (text.includes(word)) {

            return {
                valid: false,
                reason: `"${word}" detected`
            };

        }

    }

    // Passed all checks
    return {
        valid: true
    };

};



const verifyWebhook = (req, res, next) => {

    try {
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


