import { Worker } from "bullmq";
import connection from "../utils/redisClient.js";
import { processJob } from "../service/webhook.service.js";
import { updateRawEventStatus } from "../services/pipeline/rawEvent.service.js";
import { PIPELINE_STATUS } from "../constants/pipelineStatus.js";

// Concurrency configured via ENV (defaults to 5 parallel jobs)
const concurrency = Number(process.env.WEBHOOK_WORKER_CONCURRENCY) || 2;

/**
 * Single BullMQ Worker for Rojgaar Suchna V3 Webhook Processing.
 *
 * The worker delegates all pipeline logic to processJob() in webhook.service.js.
 * RawEvent status is managed inside processJob() using the rawEventId from job.data.
 */
const webhookWorker = new Worker(
    "webhook",
    async (job) => {
        const watchLabel = job.data?.watch_title || job.data?.watch_uuid || "unknown";
        console.log(`⚡ [Worker] Job ${job.id} started | Watch: ${watchLabel}`);

        const result = await processJob(job.data);

        console.log(`🎉 [Worker] Job ${job.id} completed | relevant=${result?.relevant ?? "n/a"}`);
        return result;
    },
    {
        connection,
        concurrency,
    }
);

// ─── Event listeners ──────────────────────────────────────────────────────────

webhookWorker.on("completed", (job, returnValue) => {
    console.log(`✅ [Job Completed] Job ID: ${job.id} | relevant=${returnValue?.relevant ?? "n/a"}`);
});

webhookWorker.on("failed", async (job, err) => {
    const jobId = job?.id || "unknown";
    const watchLabel = job?.data?.watch_title || job?.data?.watch_uuid || "unknown";
    const rawEventId = job?.data?.rawEventId;

    console.error(`❌ [Job Failed] Job ID: ${jobId} | Watch: ${watchLabel} | Error: ${err.message}`);

    // Update RawEvent to ai_failed if this is the final attempt
    if (rawEventId && job?.attemptsMade >= (job?.opts?.attempts ?? 3)) {
        try {
            await updateRawEventStatus(rawEventId, PIPELINE_STATUS.AI_FAILED, {
                status_note: `BullMQ final failure after ${job.attemptsMade} attempts: ${err.message}`,
                "retry.count": job.attemptsMade,
                "retry.last_error": err.message.slice(0, 500),
                "retry.last_at": new Date(),
            });
        } catch (updateErr) {
            console.error(`⚠️ [Worker] Failed to update RawEvent ${rawEventId} status: ${updateErr.message}`);
        }
    }
});

webhookWorker.on("stalled", (jobId) => {
    console.warn(`⚠️ [Job Stalled] Job ID: ${jobId} — worker likely crashed mid-processing. BullMQ will retry.`);
});

webhookWorker.on("error", (err) => {
    console.error(`❌ [Worker Error] BullMQ worker encountered an error: ${err.message}`);
});

console.log(`🚀 [Worker Ready] Webhook Worker started with concurrency: ${concurrency}`);

export default webhookWorker;