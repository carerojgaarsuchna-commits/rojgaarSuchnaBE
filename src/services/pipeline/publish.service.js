/**
 * publish.service.js
 * Stage 6 — Map validated structured notification → LatestJob.
 *
 * Responsibilities:
 *  - Resolve Department and Bodies ObjectIds by name (fuzzy match)
 *  - Map category → LatestJob type enum
 *  - Generate a unique slug
 *  - Create or update the LatestJob document
 *  - Return the created LatestJob._id
 */

import mongoose from "mongoose";
import { LatestJob } from "../../models/LatestJob.js";
import { Department } from "../../models/Department.js";
import { Bodies } from "../../models/Bodies.js";
import { buildSlug, generateUniqueSlug } from "../../utils/helper.js";

// ─── Category → LatestJob type map ───────────────────────────────────────────

const CATEGORY_TO_TYPE = {
  Job: "latest-jobs",
  Result: "results",
  "Admit Card": "admit-cards",
  "Answer Key": "answer-keys",
  Syllabus: "syllabus",
  Admission: "admissions",
  Scholarship: "scholarship",
  Tender: "notice",
  Notice: "notice",
};

/**
 * Map a pipeline category to a LatestJob type enum value.
 * @param {string} category
 * @returns {string}
 */
function mapCategoryToType(category) {
  return CATEGORY_TO_TYPE[category] || "latest-jobs";
}

// ─── Department/Bodies resolution ────────────────────────────────────────────

/**
 * Find Department by name — case-insensitive, partial match.
 * Returns ObjectId or null.
 * @param {string} name
 * @returns {Promise<mongoose.Types.ObjectId|null>}
 */
async function resolveDepartmentId(name) {
  if (!name) return null;
  try {
    const doc = await Department.findOne({
      name: { $regex: name.slice(0, 30), $options: "i" },
    })
      .select("_id")
      .lean();
    return doc?._id || null;
  } catch {
    return null;
  }
}

/**
 * Find Bodies by name — case-insensitive, partial match.
 * Returns ObjectId or null.
 * @param {string} name
 * @returns {Promise<mongoose.Types.ObjectId|null>}
 */
async function resolveBodyId(name) {
  if (!name) return null;
  try {
    const doc = await Bodies.findOne({
      name: { $regex: name.slice(0, 30), $options: "i" },
    })
      .select("_id")
      .lean();
    return doc?._id || null;
  } catch {
    return null;
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Publish a validated rawEvent to LatestJob.
 *
 * @param {object} rawEvent   — full rawEvent document (lean)
 * @returns {Promise<{ latestJobId: string, slug: string }>}
 */
export async function publishToLatestJob(rawEvent) {
  const structured = rawEvent.validation?.structured_data;

  if (!structured) {
    throw new Error("No validated structured_data found on rawEvent.validation");
  }

  // ── Resolve Department and Bodies ─────────────────────────────────────────
  const [departmentId, bodyId] = await Promise.all([
    resolveDepartmentId(structured.department),
    resolveBodyId(structured.body),
  ]);

  if (!departmentId) {
    throw new Error(
      `Could not resolve Department for name: "${structured.department}". Create it first.`
    );
  }

  if (!bodyId) {
    throw new Error(
      `Could not resolve Body for name: "${structured.body}". Create it first.`
    );
  }

  // ── Build slug ────────────────────────────────────────────────────────────
  const baseSlug = buildSlug({ title: structured.title });
  const slug = await generateUniqueSlug(baseSlug, LatestJob);

  // ── Map important_dates to LatestJob format ───────────────────────────────
  const importantDates = (structured.important_dates || []).map((d) => ({
    label: d.label,
    date: d.date,
  }));

  // ── Build LatestJob document ──────────────────────────────────────────────
  const jobData = {
    title: structured.title,
    slug,

    // Organization
    department: departmentId,
    body: bodyId,

    // Job details
    postName: structured.original_title,
    totalPosts: structured.total_posts ?? undefined,
    qualification: structured.qualification ?? undefined,
    salary: structured.salary ?? undefined,
    lastDate: structured.last_date ?? undefined,

    // Dates
    importantDates,

    // Links — PDF URL from verified pipeline artifact (not from LLM)
    notificationPdf: rawEvent.pdf?.url ?? undefined,
    officialWebsite: rawEvent.watch_url ?? undefined,
    applyLink: structured.apply_link ?? undefined,

    // Content
    content: structured.article_html,
    shortDescription: structured.summary,

    // Classification
    type: mapCategoryToType(structured.category),
    tags: structured.tags || [],

    // Pipeline traceability
    source_event_id: rawEvent._id,
    advertisement_no: structured.advertisement_no ?? undefined,

    // AI flags
    isAIGenerated: true,

    status: "active",
    publishedAt: new Date(),
  };

  const latestJob = await LatestJob.create(jobData);

  return {
    latestJobId: String(latestJob._id),
    slug: latestJob.slug,
  };
}
