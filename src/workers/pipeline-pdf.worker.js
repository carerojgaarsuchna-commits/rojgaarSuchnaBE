/**
 * pipeline-pdf.worker.js
 * Stage 3 — PDF discovery + download worker.
 *
 * Flow:
 *  1. Load raw event from MongoDB
 *  2. Read HTML snapshot from R2
 *  3. discoverPdf() — find the best PDF URL deterministically
 *  4. downloadVerifiedPdf() — fetch, SSRF-check, magic-byte verify, SHA-256
 *  5. saveArtifact() — store PDF in R2
 *  6. Update rawEvent.pdf + status → pdf_ready
 *  7. Enqueue pipeline-text
 */

import { Worker } from "bullmq";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import connection from "../utils/redisClient.js";
import { r2 } from "../config/r2.js";
import { RawEvent } from "../models/RawEvent.js";
import { PIPELINE_STATUS } from "../constants/pipelineStatus.js";
import { updateRawEventStatus } from "../services/pipeline/rawEvent.service.js";
import { discoverPdf } from "../services/pipeline/pdfDiscovery.service.js";
import { downloadVerifiedPdf } from "../services/pipeline/pdfDownload.service.js";
import { saveArtifact } from "../services/pipeline/artifactStorage.service.js";
import pipelineTextQueue from "../queues/pipeline-text.queue.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Read the stored HTML snapshot from R2.
 * @param {string} r2Key
 * @returns {Promise<string>}
 */
async function getHtmlFromR2(r2Key) {
  const bucket = process.env.R2_BUCKET_NAME;
  const response = await r2.send(new GetObjectCommand({ Bucket: bucket, Key: r2Key }));
  const chunks = [];
  for await (const chunk of response.Body) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Enqueue the next stage.
 * @param {string} rawEventId
 */
async function enqueuePipelineText(rawEventId) {
  await pipelineTextQueue.add(
    "pipeline-text",
    { raw_event_id: String(rawEventId) },
    {
      removeOnComplete: true,
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
    }
  );
}

// ─── Core processor ──────────────────────────────────────────────────────────

async function processPdfJob(rawEventId) {
  const rawEvent = await RawEvent.findById(rawEventId).lean();

  if (!rawEvent) {
    console.error("[pipeline-pdf] raw event not found:", rawEventId);
    return;
  }

  // Guard: only process matched events
  if (rawEvent.status !== PIPELINE_STATUS.MATCHED) {
    console.log(
      "[pipeline-pdf] skipping event — status is",
      rawEvent.status,
      rawEventId
    );
    return;
  }

  // Guard: need HTML snapshot
  const r2Key = rawEvent.html_snapshot?.r2_key;
  if (!r2Key) {
    console.error("[pipeline-pdf] no html_snapshot.r2_key for", rawEventId);
    await updateRawEventStatus(rawEventId, PIPELINE_STATUS.PDF_FAILED, {
      status_note: "HTML snapshot r2_key missing",
    });
    return;
  }

  const startMs = Date.now();

  try {
    // ── 1. Load HTML from R2 ──────────────────────────────────────────────────
    const html = await getHtmlFromR2(r2Key);

    const matched = rawEvent.matched_notification || {};
    const webhookPayload = rawEvent.webhook_payload || {};

    const discoveryContext = {
      matchedTitle: matched.title || "",
      matchedHref: matched.href || "",
      watchUrl: rawEvent.watch_url || "",
      diffAdded: webhookPayload.diff_added || webhookPayload.diff || "",
    };

    // ── 2. PDF Discovery ──────────────────────────────────────────────────────
    const discovery = await discoverPdf(html, discoveryContext);

    console.log(
      "[pipeline-pdf]",
      rawEventId,
      "discovery:", discovery.decision,
      "score:", discovery.score,
      "url:", discovery.pdfUrl
    );

    if (discovery.decision === "not_found") {
      await updateRawEventStatus(rawEventId, PIPELINE_STATUS.PDF_NOT_FOUND, {
        status_note: "No PDF candidate found",
        "pdf.discovery": { candidates: discovery.candidates },
      });
      return;
    }

    if (discovery.decision === "ambiguous") {
      await updateRawEventStatus(rawEventId, PIPELINE_STATUS.PDF_AMBIGUOUS, {
        status_note: "PDF candidates too close in score — requires review",
        "pdf.discovery": { candidates: discovery.candidates, top_url: discovery.pdfUrl },
      });
      return;
    }

    // ── 3. Download + verify PDF ──────────────────────────────────────────────
    const { buffer, sha256, url: finalUrl, size_bytes, content_type } =
      await downloadVerifiedPdf(discovery.pdfUrl);

    console.log(
      "[pipeline-pdf]",
      rawEventId,
      "downloaded PDF",
      size_bytes,
      "bytes sha256:", sha256.slice(0, 12) + "..."
    );

    // ── 4. Store PDF in R2 ────────────────────────────────────────────────────
    const artifact = await saveArtifact({
      prefix: "pdf",
      rawEventId,
      content: buffer,
      contentType: "application/pdf",
      extension: "pdf",
    });

    const durationMs = Date.now() - startMs;

    // ── 5. Update rawEvent ────────────────────────────────────────────────────
    await updateRawEventStatus(rawEventId, PIPELINE_STATUS.PDF_READY, {
      pdf: {
        url: finalUrl,
        r2_key: artifact.r2_key,
        sha256,
        size_bytes,
        content_type,
        discovery_score: discovery.score,
        discovery_candidates: discovery.candidates,
        downloaded_at: new Date(),
      },
      status_note: `PDF downloaded (${size_bytes} bytes) in ${durationMs}ms`,
    });

    // ── 6. Enqueue next stage ─────────────────────────────────────────────────
    await enqueuePipelineText(rawEventId);

    console.log(
      "[pipeline-pdf]",
      rawEventId,
      "done",
      `(${durationMs}ms)`,
      "→ pipeline-text enqueued"
    );
  } catch (err) {
    const durationMs = Date.now() - startMs;
    console.error(
      "[pipeline-pdf] error for",
      rawEventId,
      err.message,
      `(${durationMs}ms)`
    );

    // Classify as pdf_invalid for content/verification failures; re-throw others for retry
    const isContentError =
      err.message.includes("magic bytes") ||
      err.message.includes("Content-Type") ||
      err.message.includes("too large") ||
      err.message.includes("SSRF") ||
      err.message.includes("Disallowed protocol") ||
      err.message.includes("Invalid PDF URL");

    if (isContentError) {
      await updateRawEventStatus(rawEventId, PIPELINE_STATUS.PDF_INVALID, {
        status_note: err.message,
      });
      return; // Do NOT retry content errors
    }

    // Transient errors (network, timeout) — re-throw so BullMQ retries
    throw err;
  }
}

// ─── Worker registration ──────────────────────────────────────────────────────

new Worker(
  "pipeline-pdf",
  async (job) => {
    const rawEventId = job.data?.raw_event_id;

    if (!rawEventId) {
      throw new Error("pipeline-pdf job missing raw_event_id");
    }

    console.log("[pipeline-pdf] worker started for", rawEventId);
    await processPdfJob(rawEventId);
    console.log("[pipeline-pdf] worker finished for", rawEventId);
  },
  {
    connection,
    concurrency: 2, // Keep polite — 2 concurrent PDF downloads
  }
);

console.log("Pipeline PDF worker started");
