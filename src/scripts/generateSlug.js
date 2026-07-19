import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";

import { LatestNotification } from "../models/LatestNotification.js";
import { buildSlug, generateUniqueSlug } from "../utils/helper.js"




async function migrateSlugs() {
    await connectDB();

    const notifications = await LatestNotification.find({
        $or: [
            { slug: { $exists: false } },
            { slug: null },
            { slug: "" },
        ],
    });

    console.log(`Found ${notifications.length} documents without slug.`);

    let updated = 0;

    for (const notification of notifications) {
        console.log('---notification--',notification.title)
        const baseSlug = buildSlug(notification);
console.log('---baseSlug---',baseSlug);
        if (!baseSlug) {
            console.log(`Skipping ${notification._id} (empty title)`);
            continue;
        }

        const slug = await generateUniqueSlug(
            baseSlug,
            LatestNotification
        );

        notification.slug = slug;
        await notification.save();

        updated++;

        console.log(`${updated}. ${slug}`);
    }

    console.log(`Done. Updated ${updated} documents.`);

    await mongoose.disconnect();
}

migrateSlugs().catch((err) => {
    console.error(err);
    process.exit(1);
}).finally(async () => {
    await mongoose.disconnect();
});