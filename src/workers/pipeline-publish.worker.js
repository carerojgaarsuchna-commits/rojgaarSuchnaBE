/**
 * pipeline-publish.worker.js
 * Stage 6 — Publish worker.
 *
 * Flow:
 *  1. Load raw event from MongoDB
 *  2. Call publishToLatestJob() → maps structured data → LatestJob
 *  3. Update rawEvent status → published with LatestJob reference
 */

import { Worker } from "bullmq";
import connection from "../utils/redisClient.js";
import { RawEvent } from "../models/RawEvent.js";
import { PIPELINE_STATUS } from "../constants/pipelineStatus.js";
import { updateRawEventStatus } from "../services/pipeline/rawEvent.service.js";
import { publishToLatestJob } from "../services/pipeline/publish.service.js";

// ─── Core processor ──────────────────────────────────────────────────────────

async function processPublishJob(rawEventId) {
  const rawEvent = await RawEvent.findById(rawEventId).lean();

  if (!rawEvent) {
    console.error("[pipeline-publish] raw event not found:", rawEventId);
    return;
  }

  // Guard: only process events that are in publishing state
  if (rawEvent.status !== PIPELINE_STATUS.PUBLISHING) {
    console.log(
      "[pipeline-publish] skipping — status is",
      rawEvent.status,
      rawEventId
    );
    return;
  }

  const startMs = Date.now();

  try {
    const { latestJobId, slug } = await publishToLatestJob(rawEvent);

    const durationMs = Date.now() - startMs;

    await updateRawEventStatus(rawEventId, PIPELINE_STATUS.PUBLISHED, {
      published: {
        latest_job_id: latestJobId,
        slug,
        published_at: new Date(),
      },
      status_note: `Published to LatestJob: ${slug} (${durationMs}ms)`,
    });

    console.log(
      "[pipeline-publish]",
      rawEventId,
      "→ LatestJob created:",
      latestJobId,
      "slug:", slug,
      `(${durationMs}ms)`
    );
  } catch (err) {
    const durationMs = Date.now() - startMs;
    console.error(
      "[pipeline-publish] error for",
      rawEventId,
      err.message,
      `(${durationMs}ms)`
    );

    // Classify: resolution failures (department/body not found) are not retryable
    const isResolutionError =
      err.message.includes("Could not resolve Department") ||
      err.message.includes("Could not resolve Body") ||
      err.message.includes("No validated structured_data");

    if (isResolutionError) {
      await updateRawEventStatus(rawEventId, PIPELINE_STATUS.PUBLISH_FAILED, {
        status_note: err.message,
      });
      return; // Do NOT retry — admin must fix the Department/Body data
    }

    // Transient (DB connection, slug collision, etc.) — re-throw for BullMQ retry
    throw err;
  }
}

// ─── Worker registration ──────────────────────────────────────────────────────

new Worker(
  "pipeline-publish",
  async (job) => {
    const rawEventId = job.data?.raw_event_id;
    if (!rawEventId) throw new Error("pipeline-publish job missing raw_event_id");

    console.log("[pipeline-publish] worker started for", rawEventId);
    await processPublishJob(rawEventId);
    console.log("[pipeline-publish] worker finished for", rawEventId);
  },
  {
    connection,
    concurrency: 3,
  }
);

console.log("Pipeline publish worker started");
