import webhookQueue from "../queues/webhook.queue.js"
const receiveChange = async (req, res) => {
    try {
        await webhookQueue.add(
            "process-webhook",
            req.body, {
            removeOnComplete: true,
            attempts: 3
        }
        );

        const counts = await webhookQueue.getJobCounts(
            "waiting",
            "active",
            "completed",
            "failed"
        );

        console.log(counts);
        return res.status(200).json({
            success: true,
            message: "Webhook received",
            // data: result
        });


    } catch (err) {
        return res.status(500).json({
            status: false,
            message: err.message
        })
    }
}

export default {
    receiveChange
}