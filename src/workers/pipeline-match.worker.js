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
import pipelinePdfQueue from "../queues/pipeline-pdf.queue.js";

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
      // Store ambiguous result and route to pending_review.
      // LLM disambiguation (exception-budget call) can be added here in a later chunk.
      await updateRawEventStatus(rawEventId, PIPELINE_STATUS.PENDING_REVIEW, {
        matched_notification,
        status_note: "Ambiguous match — requires manual review or LLM disambiguation",
      });
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
