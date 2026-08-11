/**
 * pipeline-text.worker.js
 * Stage 4 — PDF text extraction + quality gate worker.
 *
 * Flow:
 *  1. Load raw event from MongoDB
 *  2. Fetch PDF buffer from R2
 *  3. extractPdfText() — pdf-parse → pdfjs-dist fallback
 *  4. runQualityGate() — assess text quality
 *  5. Save extracted text to R2 if large
 *  6. Update rawEvent.extracted_text + quality_report
 *  7. Enqueue pipeline-ai with path: 'text' or 'vision'
 */

import { Worker } from "bullmq";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import connection from "../utils/redisClient.js";
import { r2 } from "../config/r2.js";
import { RawEvent } from "../models/RawEvent.js";
import { PIPELINE_STATUS } from "../constants/pipelineStatus.js";
import { updateRawEventStatus } from "../services/pipeline/rawEvent.service.js";
import { extractPdfText } from "../services/pipeline/pdfExtract.service.js";
import { runQualityGate } from "../services/pipeline/qualityGate.service.js";
import {
  saveArtifact,
  shouldStoreInR2,
} from "../services/pipeline/artifactStorage.service.js";
import pipelineAiQueue from "../queues/pipeline-ai.queue.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Fetch binary PDF from R2 as a Buffer.
 * @param {string} r2Key
 * @returns {Promise<Buffer>}
 */
async function getPdfFromR2(r2Key) {
  const bucket = process.env.R2_BUCKET_NAME;
  const response = await r2.send(new GetObjectCommand({ Bucket: bucket, Key: r2Key }));
  const chunks = [];
  for await (const chunk of response.Body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

/**
 * Persist extracted text to R2 if it exceeds the size threshold.
 * Returns the stored reference or inline text object.
 *
 * @param {string} rawEventId
 * @param {string} text
 * @returns {Promise<{ inline?: string, r2_key?: string, size_bytes: number }>}
 */
async function storeExtractedText(rawEventId, text) {
  const size_bytes = Buffer.byteLength(text, "utf8");

  if (!shouldStoreInR2(text)) {
    return { inline: text, size_bytes };
  }

  const artifact = await saveArtifact({
    prefix: "text",
    rawEventId,
    content: text,
    contentType: "text/plain",
    extension: "txt",
  });

  return { r2_key: artifact.r2_key, size_bytes };
}

/**
 * Enqueue the AI stage with the chosen path.
 * @param {string} rawEventId
 * @param {'text'|'vision'} path
 */
async function enqueuePipelineAi(rawEventId, path) {
  await pipelineAiQueue.add(
    "pipeline-ai",
    { raw_event_id: String(rawEventId), path },
    {
      removeOnComplete: true,
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
    }
  );
}

// ─── Core processor ──────────────────────────────────────────────────────────

async function processTextJob(rawEventId) {
  const rawEvent = await RawEvent.findById(rawEventId).lean();

  if (!rawEvent) {
    console.error("[pipeline-text] raw event not found:", rawEventId);
    return;
  }

  // Guard: only process pdf_ready events
  if (rawEvent.status !== PIPELINE_STATUS.PDF_READY) {
    console.log(
      "[pipeline-text] skipping — status is",
      rawEvent.status,
      rawEventId
    );
    return;
  }

  // Guard: must have a PDF in R2
  const pdfR2Key = rawEvent.pdf?.r2_key;
  if (!pdfR2Key) {
    console.error("[pipeline-text] no pdf.r2_key for", rawEventId);
    await updateRawEventStatus(rawEventId, PIPELINE_STATUS.EXTRACTION_FAILED, {
      status_note: "pdf.r2_key missing — cannot extract text",
    });
    return;
  }

  // Mark as extracting
  await updateRawEventStatus(rawEventId, PIPELINE_STATUS.TEXT_EXTRACTING);

  const startMs = Date.now();

  try {
    // ── 1. Fetch PDF from R2 ──────────────────────────────────────────────────
    const pdfBuffer = await getPdfFromR2(pdfR2Key);

    // ── 2. Extract text ───────────────────────────────────────────────────────
    const extraction = await extractPdfText(pdfBuffer);

    if (!extraction.ok) {
      console.warn("[pipeline-text]", rawEventId, "extraction failed:", extraction.error);

      await updateRawEventStatus(rawEventId, PIPELINE_STATUS.EXTRACTION_FAILED, {
        extracted_text: { method: extraction.method, error: extraction.error },
        status_note: "Both pdf-parse and pdfjs-dist failed — routing to vision",
      });

      // Route straight to vision path
      await enqueuePipelineAi(rawEventId, "vision");
      return;
    }

    console.log(
      "[pipeline-text]",
      rawEventId,
      "extracted",
      extraction.charCount,
      "chars via",
      extraction.method
    );

    // ── 3. Quality gate ───────────────────────────────────────────────────────
    await updateRawEventStatus(rawEventId, PIPELINE_STATUS.QUALITY_GATE);

    const qualityReport = runQualityGate({
      text: extraction.text,
      pageCount: extraction.pageCount,
      charCount: extraction.charCount,
    });

    console.log(
      "[pipeline-text]",
      rawEventId,
      "quality gate:",
      qualityReport.pass ? "PASS" : "FAIL",
      `score=${qualityReport.score}`,
      qualityReport.reason
    );

    // ── 4. Store extracted text ───────────────────────────────────────────────
    const textRef = await storeExtractedText(rawEventId, extraction.text);

    const extractedTextRecord = {
      method: extraction.method,
      page_count: extraction.pageCount,
      char_count: extraction.charCount,
      ...textRef, // inline OR r2_key + size_bytes
      extracted_at: new Date(),
    };

    const aiPath = qualityReport.pass ? "text" : "vision";

    // ── 5. Update rawEvent and enqueue AI ─────────────────────────────────────
    await updateRawEventStatus(rawEventId, PIPELINE_STATUS.AI_PROCESSING, {
      extracted_text: extractedTextRecord,
      quality_report: qualityReport,
      status_note: `Quality gate ${qualityReport.pass ? "PASS" : "FAIL"} → routing to ${aiPath} LLM`,
    });

    await enqueuePipelineAi(rawEventId, aiPath);

    const durationMs = Date.now() - startMs;
    console.log(
      "[pipeline-text]",
      rawEventId,
      "done",
      `(${durationMs}ms)`,
      `→ pipeline-ai [${aiPath}] enqueued`
    );
  } catch (err) {
    const durationMs = Date.now() - startMs;
    console.error(
      "[pipeline-text] error for",
      rawEventId,
      err.message,
      `(${durationMs}ms)`
    );
    throw err; // Re-throw for BullMQ retry
  }
}

// ─── Worker registration ──────────────────────────────────────────────────────

new Worker(
  "pipeline-text",
  async (job) => {
    const rawEventId = job.data?.raw_event_id;

    if (!rawEventId) {
      throw new Error("pipeline-text job missing raw_event_id");
    }

    console.log("[pipeline-text] worker started for", rawEventId);
    await processTextJob(rawEventId);
    console.log("[pipeline-text] worker finished for", rawEventId);
  },
  {
    connection,
    concurrency: 3,
  }
);

console.log("Pipeline text worker started");
