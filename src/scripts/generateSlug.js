import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";

import { LatestNotification } from "../models/LatestNotification.js";
import { buildSlug, generateUniqueSlug } from "../utils/helper.js"

export function buildSeoSlug(title, maxLength = 60, maxWords = 8) {
    if (!title) return "";

    const stopWords = new Set([
        "the",
        "a",
        "an",
        "and",
        "or",
        "for",
        "to",
        "of",
        "on",
        "in",
        "at",
        "by",
        "with",
        "from",
        "into",
        "regarding",
        "regard",
        "link",
        "view",
        "download",
        "click",
        "here",
        "candidate",
        "candidates",
        "various",
        "latest",
        "official",
        "notification",
    ]);

    // Replace long/common phrases with SEO-friendly versions
    const replacements = [
        [/computer based test/gi, "cbt"],
        [/computer based examination/gi, "cbt"],
        [/computer based exam/gi, "cbt"],
        [/descriptive examination/gi, "descriptive-exam"],
        [/objective examination/gi, "objective-exam"],
        [/assistant loco pilot/gi, "alp"],
        [/junior judicial assistant/gi, "jja"],
        [/multi tasking staff/gi, "mts"],
        [/combined graduate level/gi, "cgl"],
        [/combined higher secondary level/gi, "chsl"],
        [/stage ii/gi, "stage-2"],
        [/stage iii/gi, "stage-3"],
        [/stage iv/gi, "stage-4"],
        [/tentative schedule/gi, "schedule"],
        [/answer key/gi, "answer-key"],
        [/admit card/gi, "admit-card"],
        [/apply online/gi, "apply-online"],
        [/result declared/gi, "result"],
        [/score card/gi, "scorecard"],
        [/score card/gi, "scorecard"],
        [/qp\/html/gi, "response"],
    ];

    let text = title;

    for (const [regex, replacement] of replacements) {
        text = text.replace(regex, replacement);
    }

    const words = text
        .toLowerCase()
        .replace(/&/g, " and ")
        .replace(/\//g, " ")
        .replace(/[()]/g, " ")
        .replace(/[^a-z0-9\s-]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .split(" ")
        .filter((word) => word && !stopWords.has(word))
        .slice(0, maxWords);

    let slug = "";

    for (const word of words) {
        const next = slug ? `${slug}-${word}` : word;

        if (next.length > maxLength) break;

        slug = next;
    }

    return slug
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
}


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
        console.log('---notification--', notification.title)

        const baseSlug = buildSeoSlug(notification.title);
        if (!baseSlug) {
            console.log(`Skipping ${notification._id} (empty title)`);
            continue;
        }
        const slug = await generateUniqueSlug(
            baseSlug,
            LatestNotification,
            notification._id
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