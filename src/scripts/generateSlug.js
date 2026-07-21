import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";

import { LatestNotification } from "../models/LatestNotification.js";
import { generateUniqueSlug } from "../utils/helper.js"
import { openRouterAPI } from "../service/ai-api/openRouterAPI.js";

export function buildSlug(item) {
    return (item || "")
        .toLowerCase()
        .replace(/[^a-z0-9\s&()-]/g, "")
        .replace(/\s+&\s+/g, " and ")
        .replace(/[\s()+]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/(^-|-$)/g, "");
}
function buildPrompt(title, summary, department) {
    return `
You are an expert at writing SEO-friendly titles for Indian government notifications.

Task:
Rewrite the official notification title into a human-friendly, search-friendly title.

Rules:
- Return ONLY the final title.
- Do not use quotes.
- Do not use markdown.
- Do not explain your reasoning.
- Do not invent any information.
- Preserve official identifiers such as CEN, Advertisement No., Notification No., Recruitment No., etc.
- Keep the organization, post, notification type, and year whenever available.
- Remove unnecessary official wording.
- Make the title natural and easy to read.
- Keep it under 80 characters whenever possible.
- Write in Title Case.

Official Title:
${title}

Summary (context only):
${summary || "N/A"}

Department (context only):
${department || "N/A"}

{
title
}
`;

}
async function migrateTitlesAndSlugs() {
    await connectDB();

    const notifications = await LatestNotification.find({
        title: { $exists: true, $ne: "" },
    });

    console.log(`Found ${notifications.length} notifications`);

    let updated = 0;

    for (const notification of notifications) {
        try {
            console.log(`\nProcessing: ${notification.title}`, notification.summary);

            const prompt = buildPrompt(notification.title, notification.summary, notification.department);

            let aiTitle = await openRouterAPI(prompt);
            console.log('aiTitle-----', aiTitle)
            // const data = JSON.parse(aiTitle);
            // console.log('---data', data)

            aiTitle = aiTitle
                ?.trim()
                .replace(/^["']|["']$/g, "");

            if (!aiTitle) {
                console.log("AI returned empty title. Skipping.");
                continue;
            }

            const baseSlug = buildSlug(aiTitle);

            if (!baseSlug) {
                console.log("Unable to generate slug. Skipping.");
                continue;
            }
            console.log('baseSlug--', baseSlug);
            const slug = await generateUniqueSlug(
                baseSlug,
                LatestNotification,
            );

            notification.title = aiTitle;
            notification.slug = slug;

            await notification.save();

            updated++;

            console.log(`✓ ${aiTitle}`);
            console.log(`✓ ${slug}`);
        } catch (err) {
            console.error(
                `Failed for ${notification._id}:`,
                err.message
            );
        }
    }

    console.log(`\nDone. Updated ${updated} notifications.`);
}

migrateTitlesAndSlugs().catch((err) => {
    console.error(err);
    process.exit(1);
}).finally(async () => {
    await mongoose.disconnect();
});