/**
 * pipeline-validate.worker.js
 * Stage 5b — Validation worker (hard gate).
 *
 * Reads AI output from rawEvent.ai.data,
 * runs schema + business validation,
 * sets pending_review (pass or fail — both go to review with reasons).
 *
 * Auto-publish is NOT implemented per plan.
 * Admin approval is required before publishing.
 */

import { Worker } from "bullmq";
import connection from "../utils/redisClient.js";
import { RawEvent } from "../models/RawEvent.js";
import { PIPELINE_STATUS } from "../constants/pipelineStatus.js";
import { updateRawEventStatus } from "../services/pipeline/rawEvent.service.js";
import { validateStructuredNotification } from "../services/pipeline/validation.service.js";

// ─── Core processor ──────────────────────────────────────────────────────────

async function processValidateJob(rawEventId) {
  const rawEvent = await RawEvent.findById(rawEventId).lean();

  if (!rawEvent) {
    console.error("[pipeline-validate] raw event not found:", rawEventId);
    return;
  }

  if (rawEvent.status !== PIPELINE_STATUS.AI_READY) {
    console.log("[pipeline-validate] skipping — status is", rawEvent.status, rawEventId);
    return;
  }

  await updateRawEventStatus(rawEventId, PIPELINE_STATUS.VALIDATING);

  const aiData = rawEvent.ai?.data;

  if (!aiData) {
    console.error("[pipeline-validate] no ai.data for", rawEventId);
    await updateRawEventStatus(rawEventId, PIPELINE_STATUS.VALIDATION_FAILED, {
      "validation.errors": ["ai.data is missing — cannot validate"],
      "validation.schema_valid": false,
      "validation.business_valid": false,
      status_note: "ai.data missing",
    });
    return;
  }

  // Inject ai meta fields into the data object so Zod can validate them
  const dataToValidate = {
    ...aiData,
    ai: {
      confidence: aiData.ai?.confidence ?? 0,
      model: rawEvent.ai?.model || "unknown",
      path: rawEvent.ai?.path || "text",
      tokens_used: rawEvent.ai?.tokens_used ?? null,
      latency_ms: rawEvent.ai?.latency_ms ?? null,
    },
  };

  const pipelineContext = {
    pdfSha256: rawEvent.pdf?.sha256 || null,
    pdfUrl: rawEvent.pdf?.url || null,
  };

  const result = validateStructuredNotification(dataToValidate, pipelineContext);

  console.log(
    "[pipeline-validate]",
    rawEventId,
    result.pass ? "PASS" : "FAIL",
    result.errors.length > 0 ? `errors: ${result.errors.join("; ")}` : ""
  );

  if (result.pass) {
    // Validation passed — route to pending_review for admin approval
    await updateRawEventStatus(rawEventId, PIPELINE_STATUS.PENDING_REVIEW, {
      validation: {
        pass: true,
        schema_valid: true,
        business_valid: true,
        errors: [],
        validated_at: new Date(),
        // Store the validated structured data for publish worker
        structured_data: result.data,
      },
      status_note: "Validation passed — awaiting admin approval",
    });
  } else {
    // Validation failed — still route to pending_review but flag the reasons
    // so admin can see and decide: fix manually or reject.
    await updateRawEventStatus(rawEventId, PIPELINE_STATUS.VALIDATION_FAILED, {
      validation: {
        pass: false,
        schema_valid: result.schema_valid,
        business_valid: result.business_valid,
        errors: result.errors,
        validated_at: new Date(),
        structured_data: result.data || null,
      },
      status_note: `Validation failed (${result.errors.length} error(s)): ${result.errors[0]}`,
    });
  }
}

// ─── Worker registration ──────────────────────────────────────────────────────

new Worker(
  "pipeline-validate",
  async (job) => {
    const rawEventId = job.data?.raw_event_id;
    if (!rawEventId) throw new Error("pipeline-validate job missing raw_event_id");

    console.log("[pipeline-validate] worker started for", rawEventId);
    await processValidateJob(rawEventId);
    console.log("[pipeline-validate] worker finished for", rawEventId);
  },
  {
    connection,
    concurrency: 5,
  }
);

console.log("Pipeline validate worker started");
