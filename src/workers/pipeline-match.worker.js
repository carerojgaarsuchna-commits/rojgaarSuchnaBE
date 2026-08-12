/**
 * pipeline-match.worker.js
 * Stage 1 — Notification matching worker.
 *
 * Reads HTML from R2, runs deterministic matching,
 * stores result in rawEvent.matched_notification,
 * and enqueues pipeline-pdf on a high-confidence match.
 */

import { Worker } from "bullmq";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import connection from "../utils/redisClient.js";
import { r2 } from "../config/r2.js";
import { RawEvent } from "../models/RawEvent.js";
import { PIPELINE_STATUS } from "../constants/pipelineStatus.js";
import { updateRawEventStatus } from "../services/pipeline/rawEvent.service.js";
import { runMatching } from "../services/pipeline/matching.service.js";
import { callTextLlm, getTextModel } from "../service/ai-api/aiProvider.js";
import pipelinePdfQueue from "../queues/pipeline-pdf.queue.js";

// ─── LLM disambiguation ──────────────────────────────────────────────────────

/**
 * Ask the LLM to pick the best candidate from an ambiguous set.
 * Exception budget: max 1 call per event (per plan).
 *
 * @param {string} diffAdded          — the diff_added text from the webhook
 * @param {string} watchTitle         — site name for context
 * @param {Array}  candidates         — top candidates [{title, href, score}]
 * @returns {Promise<{title,href}|null>}  — chosen candidate or null on failure
 */
async function disambiguateWithLlm(diffAdded, watchTitle, candidates) {
  const model = getTextModel();

  // Extract newly relevant lines from the diff:
  // (added) lines = brand-new items added to the page (highest priority)
  // (into)  lines = modified existing items (also relevant)
  const addedLines = diffAdded
    .split("\n")
    .filter((l) => l.trimStart().startsWith("(added)"))
    .map((l) => l.replace(/^\s*\(added\)\s*/, "").trim())
    .filter(Boolean);

  const intoLines = diffAdded
    .split("\n")
    .filter((l) => l.trimStart().startsWith("(into)"))
    .map((l) => l.replace(/^\s*\(into\)\s*/, "").trim())
    .filter(Boolean);

  // Combine: newly added first (most important), then modified
  const parts = [];
  if (addedLines.length) parts.push("NEWLY ADDED:\n" + addedLines.join("\n"));
  if (intoLines.length) parts.push("UPDATED ITEMS:\n" + intoLines.join("\n"));
  const diffContext = parts.length ? parts.join("\n\n") : diffAdded.slice(0, 1500);

  const candidateLines = candidates
    .map((c, i) => `${i + 1}. Title: "${c.title}"\n   URL:   ${c.href}`)
    .join("\n");

  const prompt = `You are a government recruitment notification classifier for the Indian job portal Rojgaar Suchna.

A website ("${watchTitle}") was updated. Here is what changed:
---
${diffContext.slice(0, 1500)}
---

These are the top matching notification links found on the page:
${candidateLines}

Which single link (by number) best matches the change above?
IMPORTANT: Prefer links that end in .pdf over image files (.jpg/.png).
Return ONLY a JSON object: { "choice": <number 1-${candidates.length}> }
No other text.`;

  try {
    const { raw } = await callTextLlm(prompt, model);
    // Strip markdown fences if present
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
    const parsed = JSON.parse(cleaned);
    const idx = parseInt(parsed?.choice, 10) - 1;
    if (!isNaN(idx) && idx >= 0 && idx < candidates.length) {
      return candidates[idx];
    }
  } catch (err) {
    console.warn("[pipeline-match] LLM disambiguation failed:", err.message);
  }
  return null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Download the stored HTML snapshot from R2.
 * @param {string} r2Key
 * @returns {Promise<string>}
 */
async function getHtmlFromR2(r2Key) {
  const bucket = process.env.R2_BUCKET_NAME;
  const cmd = new GetObjectCommand({ Bucket: bucket, Key: r2Key });
  const response = await r2.send(cmd);

  // response.Body is a ReadableStream — convert to string
  const chunks = [];
  for await (const chunk of response.Body) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Enqueue the next pipeline stage (pdf).
 * @param {string} rawEventId
 */
async function enqueuePipelinePdf(rawEventId) {
  await pipelinePdfQueue.add(
    "pipeline-pdf",
    { raw_event_id: String(rawEventId) },
    {
      removeOnComplete: true,
      attempts: 3,
      backoff: { type: "exponential", delay: 3000 },
    }
  );
}

// ─── Core processor ──────────────────────────────────────────────────────────

async function processMatchJob(rawEventId) {
  const rawEvent = await RawEvent.findById(rawEventId).lean();

  if (!rawEvent) {
    console.error("[pipeline-match] raw event not found:", rawEventId);
    return;
  }

  // Guard: only process events that are html_ready
  if (rawEvent.status !== PIPELINE_STATUS.HTML_READY) {
    console.log(
      "[pipeline-match] skipping event — status is",
      rawEvent.status,
      rawEventId
    );
    return;
  }

  // Guard: must have an HTML snapshot in R2
  const r2Key = rawEvent.html_snapshot?.r2_key;
  if (!r2Key) {
    console.error("[pipeline-match] no r2_key on html_snapshot for", rawEventId);
    await updateRawEventStatus(rawEventId, PIPELINE_STATUS.MATCH_FAILED, {
      status_note: "HTML snapshot r2_key missing",
    });
    return;
  }

  // Mark as matching
  await updateRawEventStatus(rawEventId, PIPELINE_STATUS.MATCHING);

  const startMs = Date.now();

  try {
    // 1. Fetch HTML from R2
    const html = await getHtmlFromR2(r2Key);

    // 2. Build matching context from stored webhook payload
    const webhookPayload = rawEvent.webhook_payload || {};
    const context = {
      diff_added: webhookPayload.diff_added || webhookPayload.diff || "",
      watch_url: rawEvent.watch_url || "",
      watch_title: rawEvent.watch_title || "",
    };

    // 3. Run deterministic matching
    const { decision, matched_notification } = runMatching(html, context);

    const durationMs = Date.now() - startMs;
    console.log(
      "[pipeline-match]",
      rawEventId,
      "decision:", decision,
      "score:", matched_notification.score,
      "method:", matched_notification.method,
      `(${durationMs}ms)`
    );

    // 4. Act on decision
    if (decision === "high") {
      await updateRawEventStatus(rawEventId, PIPELINE_STATUS.MATCHED, {
        matched_notification,
      });
      await enqueuePipelinePdf(rawEventId);
      return;
    }

    if (decision === "ambiguous") {
      // Exception-budget: one LLM call to pick the best candidate
      console.log("[pipeline-match]", rawEventId, "— calling LLM to disambiguate");
      const chosen = await disambiguateWithLlm(
        context.diff_added,
        context.watch_title,
        matched_notification.candidates
      );

      if (chosen) {
        // LLM resolved ambiguity → treat as matched, proceed to PDF
        const resolvedNotification = {
          ...matched_notification,
          title: chosen.title,
          href: chosen.href,
          method: "llm",
        };
        await updateRawEventStatus(rawEventId, PIPELINE_STATUS.MATCHED, {
          matched_notification: resolvedNotification,
        });
        await enqueuePipelinePdf(rawEventId);
        console.log("[pipeline-match]", rawEventId, "— LLM chose:", chosen.title);
      } else {
        // LLM failed or returned invalid — fall back to manual review
        await updateRawEventStatus(rawEventId, PIPELINE_STATUS.PENDING_REVIEW, {
          matched_notification,
          status_note: "Ambiguous match — LLM disambiguation failed, requires manual review",
        });
        console.warn("[pipeline-match]", rawEventId, "— LLM disambiguation failed, sent to pending_review");
      }
      return;
    }

    // no_match
    await updateRawEventStatus(rawEventId, PIPELINE_STATUS.MATCH_FAILED, {
      matched_notification,
      status_note: "No candidate scored above threshold",
    });
  } catch (err) {
    const durationMs = Date.now() - startMs;
    console.error(
      "[pipeline-match] error for",
      rawEventId,
      err.message,
      `(${durationMs}ms)`
    );
    throw err; // BullMQ will retry transient errors
  }
}

// ─── Worker registration ──────────────────────────────────────────────────────

new Worker(
  "pipeline-match",
  async (job) => {
    const rawEventId = job.data?.raw_event_id;

    if (!rawEventId) {
      throw new Error("pipeline-match job missing raw_event_id");
    }

    console.log("[pipeline-match] worker started for", rawEventId);
    await processMatchJob(rawEventId);
    console.log("[pipeline-match] worker finished for", rawEventId);
  },
  {
    connection,
    concurrency: 2,
  }
);

console.log("Pipeline match worker started");
