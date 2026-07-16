import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import webhookQueue from "../queues/webhook.queue.js";
import { processJob } from "../service/webhook.service.js";

async function main() {
    await connectDB();

    // Get queue counts
    const counts = await webhookQueue.getJobCounts("failed");

    console.log(`Failed Jobs: ${counts.failed}`);

    if (counts.failed === 0) {
        console.log("No failed jobs found.");
        return;
    }

    // Get all failed jobs
    const failedJobs = await webhookQueue.getFailed();

    console.log(`Processing ${failedJobs.length} failed jobs...\n`);

    for (const job of failedJobs) {
        console.log(`Processing Job ID: ${job.id}`);

        try {
            const success = await processJob(job.data);

            if (success) {
                await job.remove();
                console.log(`✅ Job ${job.id} removed from failed queue.`);
            } else {
                console.log(`❌ Job ${job.id} still failed.`);
            }
        } catch (err) {
            console.error(`💥 Error processing Job ${job.id}:`, err.message);
        }
    }

    console.log("\nDone.");
}

main().catch((err) => {
    console.error("Retry script failed:", err);
    process.exit(1);
}).finally(async () => {
    await Promise.allSettled([
        webhookQueue.close(),
        mongoose.disconnect(),
        process.exit(1)

    ]);
});
