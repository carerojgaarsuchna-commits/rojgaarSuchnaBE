/**
 * structuredNotification.validator.js
 * Zod schema for the LLM structured output.
 *
 * The LLM must return this exact shape.
 * Backend validates it as a hard gate before any further processing.
 */

import { z } from "zod";
import { ALLOWED_NOTIFICATION_CATEGORIES } from "../utils/notificationCategory.js";

// ─── Allowed values ───────────────────────────────────────────────────────────

const NOTIFICATION_TYPES = [
  "New Recruitment",
  "Re-Advertisement",
  "Corrigendum",
  "Result",
  "Admit Card",
  "Answer Key",
  "Syllabus",
  "Admission",
  "Scholarship",
  "Tender",
  "Notice",
  "Other",
];

const CATEGORY_ENUM = z.enum(
  /** @type {[string, ...string[]]} */ (ALLOWED_NOTIFICATION_CATEGORIES)
);

// ─── Helper validators ────────────────────────────────────────────────────────

const optionalUrl = z
  .string()
  .url()
  .optional()
  .nullable()
  .or(z.literal("").transform(() => null));

const optionalDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD")
  .optional()
  .nullable()
  .or(z.literal("").transform(() => null));

const confidence = z.number().min(0).max(100);

// ─── Structured notification schema ──────────────────────────────────────────

export const StructuredNotificationSchema = z.object({
  // Core identity
  title: z.string().min(5).max(300).trim(),
  original_title: z.string().min(3).max(500).trim(),
  advertisement_no: z.string().max(100).optional().nullable(),

  // Classification
  category: CATEGORY_ENUM,
  notification_type: z.enum(
    /** @type {[string, ...string[]]} */ (NOTIFICATION_TYPES)
  ),
  notification_date: optionalDate,

  // Organization
  department: z.string().min(2).max(200).trim(),
  body: z.string().min(2).max(200).trim(),

  // Job details (optional — not always in every notification)
  total_posts: z.number().int().positive().optional().nullable(),
  qualification: z.string().max(500).optional().nullable(),
  salary: z.string().max(200).optional().nullable(),
  age_limit: z.string().max(200).optional().nullable(),
  last_date: optionalDate,

  // Dates (array of { label, date })
  important_dates: z
    .array(
      z.object({
        label: z.string().min(1).max(100),
        date: z.string().max(50),
      })
    )
    .optional()
    .default([]),

  // Links (provided by backend — LLM suggests, backend verifies)
  apply_link: optionalUrl,

  // Summary (2-3 sentences)
  summary: z.string().min(20).max(600).trim(),

  // SEO article (HTML)
  article_html: z.string().min(100).trim(),

  // Tags for search
  tags: z.array(z.string().max(50)).max(15).optional().default([]),

  // AI meta
  ai: z.object({
    confidence: confidence,
    model: z.string(),
    path: z.enum(["text", "vision"]),
    tokens_used: z.number().optional().nullable(),
    latency_ms: z.number().optional().nullable(),
  }),
});

/** @typedef {z.infer<typeof StructuredNotificationSchema>} StructuredNotification */
