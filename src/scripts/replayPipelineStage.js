/**
 * replayPipelineStage.js
 * Chunk 7 — Manual replay script for failed pipeline events.
 *
 * Usage:
 *   node src/scripts/replayPipelineStage.js --id=<rawEventId> --from=<stage>
 *
 * Stages supported:
 *   match    → resets status to html_ready & enqueues pipeline-match
 *   pdf      → resets status to matched & enqueues pipeline-pdf
 *   text     → resets status to pdf_ready & enqueues pipeline-text
 *   ai       → resets status to ai_processing & enqueues pipeline-ai (text path)
 *   validate → resets status to ai_ready & enqueues pipeline-validate
 *   publish  → resets status to pending_review & enqueues pipeline-publish
 */

import "dotenv/config";
import { connectDB } from "../config/db.js";
import { RawEvent } from "../models/RawEvent.js";
import { PIPELINE_STATUS } from "../constants/pipelineStatus.js";
import { updateRawEventStatus } from "../services/pipeline/rawEvent.service.js";

import pipelineMatchQueue from "../queues/pipeline-match.queue.js";
import pipelinePdfQueue from "../queues/pipeline-pdf.queue.js";
import pipelineTextQueue from "../queues/pipeline-text.queue.js";
import pipelineAiQueue from "../queues/pipeline-ai.queue.js";
import pipelineValidateQueue from "../queues/pipeline-validate.queue.js";
import pipelinePublishQueue from "../queues/pipeline-publish.queue.js";

function parseArgs() {
  const args = process.argv.slice(2);
  const params = {};

  args.forEach((arg) => {
    if (arg.startsWith("--id=")) {
      params.id = arg.split("=")[1]?.trim();
    } else if (arg.startsWith("--from=")) {
      params.from = arg.split("=")[1]?.trim().toLowerCase();
    }
  });

  return params;
}

async function replayStage() {
  const { id, from } = parseArgs();

  if (!id || !from) {
    console.error("\n❌ Usage: node src/scripts/replayPipelineStage.js --id=<rawEventId> --from=<stage>");
    console.error("   Available stages: match, pdf, text, ai, validate, publish\n");
    process.exit(1);
  }

  await connectDB();

  const rawEvent = await RawEvent.findById(id);

  if (!rawEvent) {
    console.error(`\n❌ RawEvent not found: ${id}\n`);
    process.exit(1);
  }

  console.log(`\nFound RawEvent ${id} (${rawEvent.watch_title || "No Title"})`);
  console.log(`Current Status: ${rawEvent.status}`);

  switch (from) {
    case "match":
      await updateRawEventStatus(id, PIPELINE_STATUS.HTML_READY, {
        status_note: "Manual replay requested from stage: match",
      });
      await pipelineMatchQueue.add("pipeline-match", { raw_event_id: id });
      console.log(`✅ Reset status to 'html_ready' and enqueued pipeline-match`);
      break;

    case "pdf":
      await updateRawEventStatus(id, PIPELINE_STATUS.MATCHED, {
        status_note: "Manual replay requested from stage: pdf",
      });
      await pipelinePdfQueue.add("pipeline-pdf", { raw_event_id: id });
      console.log(`✅ Reset status to 'matched' and enqueued pipeline-pdf`);
      break;

    case "text":
      await updateRawEventStatus(id, PIPELINE_STATUS.PDF_READY, {
        status_note: "Manual replay requested from stage: text",
      });
      await pipelineTextQueue.add("pipeline-text", { raw_event_id: id });
      console.log(`✅ Reset status to 'pdf_ready' and enqueued pipeline-text`);
      break;

    case "ai":
      await updateRawEventStatus(id, PIPELINE_STATUS.AI_PROCESSING, {
        status_note: "Manual replay requested from stage: ai",
      });
      await pipelineAiQueue.add("pipeline-ai", { raw_event_id: id, path: "text" });
      console.log(`✅ Reset status to 'ai_processing' and enqueued pipeline-ai`);
      break;

    case "validate":
      await updateRawEventStatus(id, PIPELINE_STATUS.AI_READY, {
        status_note: "Manual replay requested from stage: validate",
      });
      await pipelineValidateQueue.add("pipeline-validate", { raw_event_id: id });
      console.log(`✅ Reset status to 'ai_ready' and enqueued pipeline-validate`);
      break;

    case "publish":
      await updateRawEventStatus(id, PIPELINE_STATUS.PENDING_REVIEW, {
        status_note: "Manual replay requested from stage: publish",
      });
      await pipelinePublishQueue.add("pipeline-publish", { raw_event_id: id });
      console.log(`✅ Reset status to 'pending_review' and enqueued pipeline-publish`);
      break;

    default:
      console.error(`\n❌ Unknown stage '${from}'. Valid stages: match, pdf, text, ai, validate, publish\n`);
      process.exit(1);
  }

  process.exit(0);
}

replayStage().catch((err) => {
  console.error("Replay script failed:", err);
  process.exit(1);
});
