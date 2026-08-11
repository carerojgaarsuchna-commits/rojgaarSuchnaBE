/**
 * pipeline-ai.worker.js
 * Stage 5a — AI extraction worker.
 *
 * Reads raw event, fetches PDF or extracted text from R2,
 * calls the appropriate LLM (text or vision),
 * stores raw AI response, then enqueues pipeline-validate.
 */

import { Worker } from "bullmq";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import connection from "../utils/redisClient.js";
import { r2 } from "../config/r2.js";
import { RawEvent } from "../models/RawEvent.js";
import { PIPELINE_STATUS } from "../constants/pipelineStatus.js";
import { updateRawEventStatus } from "../services/pipeline/rawEvent.service.js";
import { extractWithTextLlm, extractWithVisionLlm } from "../services/pipeline/aiExtract.service.js";
import { saveArtifact, shouldStoreInR2 } from "../services/pipeline/artifactStorage.service.js";
import pipelineValidateQueue from "../queues/pipeline-validate.queue.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getFromR2(r2Key) {
  const bucket = process.env.R2_BUCKET_NAME;
  const response = await r2.send(new GetObjectCommand({ Bucket: bucket, Key: r2Key }));
  const chunks = [];
  for await (const chunk of response.Body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function enqueueValidate(rawEventId) {
  await pipelineValidateQueue.add(
    "pipeline-validate",
    { raw_event_id: String(rawEventId) },
    {
      removeOnComplete: true,
      attempts: 2,
      backoff: { type: "exponential", delay: 5000 },
    }
  );
}

// ─── Core processor ──────────────────────────────────────────────────────────

async function processAiJob(rawEventId, path) {
  const rawEvent = await RawEvent.findById(rawEventId).lean();

  if (!rawEvent) {
    console.error("[pipeline-ai] raw event not found:", rawEventId);
    return;
  }

  if (rawEvent.status !== PIPELINE_STATUS.AI_PROCESSING) {
    console.log("[pipeline-ai] skipping — status is", rawEvent.status, rawEventId);
    return;
  }

  const startMs = Date.now();
  const meta = {
    matchedTitle: rawEvent.matched_notification?.title || "",
    watchTitle: rawEvent.watch_title || "",
    watchUrl: rawEvent.watch_url || "",
  };

  try {
    let aiResult;

    if (path === "vision") {
      // Vision path: fetch the verified PDF buffer from R2
      const pdfR2Key = rawEvent.pdf?.r2_key;
      if (!pdfR2Key) {
        throw new Error("Vision path requested but pdf.r2_key missing");
      }
      const pdfBuffer = await getFromR2(pdfR2Key);

      let extractedText = rawEvent.extracted_text?.inline || "";
      if (!extractedText && rawEvent.extracted_text?.r2_key) {
        try {
          const textBuffer = await getFromR2(rawEvent.extracted_text.r2_key);
          extractedText = textBuffer.toString("utf8");
        } catch {
          // Ignore R2 text fetch error for fallback
        }
      }

      console.log("[pipeline-ai]", rawEventId, "calling vision LLM");
      aiResult = await extractWithVisionLlm({ pdfBuffer, extractedText, ...meta });
    } else {
      // Text path: prefer r2_key if stored there, else use inline text
      let extractedText = rawEvent.extracted_text?.inline || "";

      if (!extractedText && rawEvent.extracted_text?.r2_key) {
        const textBuffer = await getFromR2(rawEvent.extracted_text.r2_key);
        extractedText = textBuffer.toString("utf8");
      }

      if (!extractedText) {
        throw new Error("Text path requested but no extracted text available");
      }

      console.log("[pipeline-ai]", rawEventId, "calling text LLM, chars:", extractedText.length);
      aiResult = await extractWithTextLlm({ extractedText, ...meta });
    }

    const durationMs = Date.now() - startMs;

    console.log(
      "[pipeline-ai]",
      rawEventId,
      "LLM done in", durationMs + "ms",
      "ok:", aiResult.ok,
      "exception_calls:", aiResult.exception_calls,
      "model:", aiResult.model
    );

    if (!aiResult.ok) {
      await updateRawEventStatus(rawEventId, PIPELINE_STATUS.AI_FAILED, {
        "ai.error": aiResult.error,
        "ai.path": path,
        "ai.model": aiResult.model,
        "ai.latency_ms": durationMs,
        status_note: `AI extraction failed after reprompt: ${aiResult.error}`,
      });
      return;
    }

    // Store raw AI response in R2 if large
    const rawResponseStr = JSON.stringify({ data: aiResult.data, raw: aiResult.raw });
    let aiResponseRef = {};

    if (shouldStoreInR2(rawResponseStr)) {
      const artifact = await saveArtifact({
        prefix: "ai-response",
        rawEventId,
        content: rawResponseStr,
        contentType: "application/json",
        extension: "json",
      });
      aiResponseRef = { ai_response_r2_key: artifact.r2_key };
    }

    await updateRawEventStatus(rawEventId, PIPELINE_STATUS.AI_READY, {
      ai: {
        path,
        model: aiResult.model,
        latency_ms: durationMs,
        exception_calls: aiResult.exception_calls,
        data: aiResult.data, // structured output
        ...aiResponseRef,
        extracted_at: new Date(),
      },
    });

    await enqueueValidate(rawEventId);

    console.log("[pipeline-ai]", rawEventId, "→ pipeline-validate enqueued");
  } catch (err) {
    const durationMs = Date.now() - startMs;
    console.error("[pipeline-ai] error for", rawEventId, err.message, `(${durationMs}ms)`);
    throw err; // BullMQ retry for transient failures
  }
}

// ─── Worker registration ──────────────────────────────────────────────────────

new Worker(
  "pipeline-ai",
  async (job) => {
    const rawEventId = job.data?.raw_event_id;
    const path = job.data?.path || "text";

    if (!rawEventId) throw new Error("pipeline-ai job missing raw_event_id");

    console.log("[pipeline-ai] worker started for", rawEventId, "path:", path);
    await processAiJob(rawEventId, path);
    console.log("[pipeline-ai] worker finished for", rawEventId);
  },
  {
    connection,
    concurrency: 1, // Controlled AI concurrency — one at a time
  }
);

console.log("Pipeline AI worker started");
