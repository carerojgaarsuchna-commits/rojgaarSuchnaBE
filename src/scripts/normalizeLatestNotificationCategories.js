import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import { LatestNotification } from "../models/LatestNotification.js";

async function main() {
    await connectDB();

    const operations = [
        {
            updateMany: {
                filter: { category: "Job Vacancy" },
                update: { $set: { category: "Job" } },
            },
        },
        {
            updateMany: {
                filter: { category: "Other" },
                update: { $set: { category: "Notice" } },
            },
        },
    ];

    const result = await LatestNotification.bulkWrite(operations);

    const modifiedCount =
        (result.result?.nModified ?? 0)
        || result.modifiedCount
        || 0;

    console.log(`Normalized ${modifiedCount} LatestNotification categories.`);
}

main().catch((err) => {
    console.error("Category normalization failed:", err);
    process.exit(1);
}).finally(async () => {
    await mongoose.disconnect();
});
