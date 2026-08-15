import { Worker } from "bullmq";
import connection from "../utils/redisClient.js";
import { processJob } from "../service/webhook.service.js";

// Concurrency configured via ENV (defaults to 5 parallel jobs)
const concurrency = Number(process.env.WEBHOOK_WORKER_CONCURRENCY) || 5;

/**
 * Single BullMQ Worker for Rojgaar Suchna V3 Webhook Processing.
 */
const webhookWorker = new Worker(
    "webhook",
    async (job) => {
        console.log(`⚡ [Worker Starting] Job ID: ${job.id} | Watch: ${job.data?.watch_title || job.data?.watch_uuid}`);
        const result = await processJob(job.data);
        console.log(`🎉 [Worker Complete] Job ID: ${job.id} finished processing successfully.`);
        return result;
    },
    {
        connection,
        concurrency,
    }
);

webhookWorker.on("completed", (job) => {
    console.log(`✅ [Job Completed] Job ID: ${job.id}`);
});

webhookWorker.on("failed", (job, err) => {
    console.error(`❌ [Job Failed] Job ID: ${job?.id || "unknown"} failed with error: ${err.message}`);
});

console.log(`🚀 [Worker Ready] Webhook Worker started with concurrency level: ${concurrency}`);

export default webhookWorker;