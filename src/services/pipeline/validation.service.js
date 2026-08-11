/**
 * validation.service.js
 * Stage 5b — Backend validation (hard gate).
 *
 * Two layers:
 *  1. Schema validation — Zod parse
 *  2. Business validation — cross-checks between fields
 *
 * If either layer fails, the event goes to pending_review with reasons attached.
 * Invalid output NEVER proceeds silently to publication.
 */

import { StructuredNotificationSchema } from "../../validators/structuredNotification.validator.js";

// ─── Business rule checkers ───────────────────────────────────────────────────

/**
 * Date must be reasonable for an Indian government notification.
 * Acceptable range: 2000-01-01 to 5 years from today.
 */
function isReasonableDate(dateStr) {
  if (!dateStr) return true; // null/optional dates are fine
  const d = new Date(dateStr);
  if (isNaN(d)) return false;
  const minYear = 2000;
  const maxYear = new Date().getFullYear() + 5;
  return d.getFullYear() >= minYear && d.getFullYear() <= maxYear;
}

/**
 * Check total_posts is a sane value (not negative, not absurdly large).
 */
function isReasonablePostCount(count) {
  if (count === null || count === undefined) return true;
  return Number.isInteger(count) && count > 0 && count <= 1000000;
}

/**
 * Check that the article_html contains at least a few of the key structured fields.
 * This catches cases where the LLM returned a valid schema but wrote an unrelated article.
 */
function articleMentionsTitle(articleHtml, title) {
  if (!articleHtml || !title) return true; // Skip if either missing
  const articleLower = articleHtml.toLowerCase();
  // At least one word from the title (3+ chars) should appear in the article
  const words = title
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length >= 4);
  return words.some((w) => articleLower.includes(w));
}

/**
 * Verify the advertisement number does not look obviously fabricated.
 * Fabricated ones often have impossible patterns (year 9999, all zeros, etc.)
 */
function isReasonableAdNo(adNo) {
  if (!adNo) return true;
  const suspiciousPatterns = [/9999/, /0000/, /^0+$/, /^[^0-9a-zA-Z]+$/];
  return !suspiciousPatterns.some((re) => re.test(adNo));
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Run schema + business validation on LLM structured output.
 *
 * @param {object} rawData              — parsed JSON from LLM
 * @param {{ pdfSha256:string, pdfUrl:string }} pipelineContext
 * @returns {{
 *   pass: boolean,
 *   data?: import('../validators/structuredNotification.validator.js').StructuredNotification,
 *   errors: string[],
 *   schema_valid: boolean,
 *   business_valid: boolean
 * }}
 */
export function validateStructuredNotification(rawData, pipelineContext = {}) {
  const errors = [];

  // ── Layer 1: Schema validation ────────────────────────────────────────────
  const schemaResult = StructuredNotificationSchema.safeParse(rawData);

  if (!schemaResult.success) {
    const zodErrors = schemaResult.error.issues.map(
      (issue) => `${issue.path.join(".")}: ${issue.message}`
    );
    errors.push(...zodErrors);

    return {
      pass: false,
      errors,
      schema_valid: false,
      business_valid: false,
    };
  }

  const data = schemaResult.data;

  // ── Layer 2: Business validation ──────────────────────────────────────────
  const businessErrors = [];

  // Check 1: Reasonable notification date
  if (!isReasonableDate(data.notification_date)) {
    businessErrors.push(
      `notification_date "${data.notification_date}" is out of reasonable range`
    );
  }

  // Check 2: Reasonable last_date
  if (!isReasonableDate(data.last_date)) {
    businessErrors.push(`last_date "${data.last_date}" is out of reasonable range`);
  }

  // Check 3: Reasonable post count
  if (!isReasonablePostCount(data.total_posts)) {
    businessErrors.push(`total_posts "${data.total_posts}" is not a valid count`);
  }

  // Check 4: Advertisement number sanity
  if (!isReasonableAdNo(data.advertisement_no)) {
    businessErrors.push(
      `advertisement_no "${data.advertisement_no}" appears fabricated`
    );
  }

  // Check 5: Article mentions at least part of the title (basic consistency)
  if (!articleMentionsTitle(data.article_html, data.title)) {
    businessErrors.push(
      "article_html does not appear to be about the extracted notification title"
    );
  }

  // Check 6: Summary not just a copy of title
  if (
    data.summary &&
    data.title &&
    data.summary.trim().toLowerCase() === data.title.trim().toLowerCase()
  ) {
    businessErrors.push("summary is identical to title — likely a low-quality extraction");
  }

  // Check 7: Verified PDF must exist (pipeline context check)
  if (!pipelineContext.pdfSha256) {
    businessErrors.push("No verified PDF checksum — cannot publish unverified content");
  }

  // Check 8: Tags should not be empty for Job/Result categories
  if (
    ["Job", "Result", "Admit Card"].includes(data.category) &&
    (!data.tags || data.tags.length === 0)
  ) {
    businessErrors.push(
      `tags array is empty for category "${data.category}" — at least one tag expected`
    );
  }

  if (businessErrors.length > 0) {
    errors.push(...businessErrors);
    return {
      pass: false,
      data,
      errors,
      schema_valid: true,
      business_valid: false,
    };
  }

  return {
    pass: true,
    data,
    errors: [],
    schema_valid: true,
    business_valid: true,
  };
}
