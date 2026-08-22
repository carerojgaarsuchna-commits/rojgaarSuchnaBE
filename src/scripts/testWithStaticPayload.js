import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import { processJob } from "../service/webhook.service.js";
import staticPayload from "../../staticwebhook.js";

// Helper for rate-limiting delay between requests
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function main() {
    try {
        console.log("🚀 Starting static payload processing...\n");

        // Connect MongoDB
        await connectDB();

        const limit = process.env.LIMIT ? Number(process.env.LIMIT) : staticPayload.length;
        const payloadsToProcess = staticPayload.slice(0, limit);

        console.log(`📦 Total static payloads: ${staticPayload.length} (processing first ${payloadsToProcess.length})\n`);

        if (payloadsToProcess.length === 0) {
            console.log("No static payloads found.");
            return;
        }

        let successCount = 0;
        let failedCount = 0;

        for (let i = 0; i < payloadsToProcess.length; i++) {
            const item = payloadsToProcess[i];

            console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
            console.log(`Processing payload ${i + 1}/${payloadsToProcess.length}`);

            try {
                // Extract actual webhook payload
                const payload = item.webhook_payload;

                if (!payload) {
                    throw new Error("webhook_payload is missing");
                }

                console.log(`Diff Added Summary: ${payload.diff_added ? payload.diff_added.slice(0, 100).replace(/\n/g, ' ') + '...' : 'N/A'}`);
                console.log(`Watch UUID: ${payload.watch_uuid || "N/A"}`);
                console.log(`Watch Title: ${payload.watch_title || "N/A"}`);

                // Send payload through existing pipeline
                const result = await processJob(payload);

                console.log("✅ Processing successful");

                if (result !== undefined) {
                    console.log("Result:", result);
                }

                successCount++;
            } catch (err) {
                failedCount++;
                console.error(`❌ Failed to process payload ${i + 1}:`, err.message);
                continue;
            }
            // Small delay between calls to respect RPM limits

            await sleep(4000);

        }

        console.log("\n========================================");
        console.log("Static payload processing completed");
        console.log("========================================");
        console.log(`Total Processed : ${payloadsToProcess.length}`);
        console.log(`Success         : ${successCount}`);
        console.log(`Failed          : ${failedCount}`);
        console.log("========================================\n");
    } catch (err) {
        console.error("💥 Script failed:", err);
        process.exitCode = 1;
    } finally {
        await mongoose.disconnect();
        console.log("🔌 MongoDB disconnected.");
    }
}

main();
