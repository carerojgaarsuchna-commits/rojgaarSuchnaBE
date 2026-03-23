import { z } from "zod";

export const latestJobsAIPromptSchema = z.object({
    title: z
        .string()
        .min(5, "Title must be at least 5 characters")
        .max(200),

    department: z
        .string()
        .regex(/^[0-9a-fA-F]{24}$/, "Invalid Department ID"),

    body: z
        .string()
        .regex(/^[0-9a-fA-F]{24}$/, "Invalid Body ID"),

    type: z.enum([
        "latest-jobs",
        "results",
        "admit-cards",
        "answer-keys",
        "syllabus",
        "documents",
        "scheme",
        "scholarship",
        "notice",
        "admissions"
    ]),

    applyLink: z
        .string()
        .url("Invalid applyLink  URL"),

    officialWebsite: z
        .string()
        .url("Invalid officialWebsite URL"),
    status: z.enum(["active", "draft", "expired"]),
    isFeatured: z.boolean().optional(),
    notificationPdf: z.string().min(1, "PDF path required"),
    blogTxt: z
        .string()
        .min(50, "Content too short"),
})