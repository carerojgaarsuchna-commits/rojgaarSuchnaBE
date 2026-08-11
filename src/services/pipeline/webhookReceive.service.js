import webhookQueue from "../../queues/webhook.queue.js";
import pipelineMatchQueue from "../../queues/pipeline-match.queue.js";
import {
  createRawEvent,
  fetchAndStoreHtml,
} from "./rawEvent.service.js";
import { PIPELINE_STATUS } from "../../constants/pipelineStatus.js";

const USE_LEGACY_WEBHOOK = process.env.USE_LEGACY_WEBHOOK === "true";

async function enqueueLegacyWebhook(payload) {
  if (!USE_LEGACY_WEBHOOK) {
    return;
  }

  await webhookQueue.add("process-webhook", payload, {
    removeOnComplete: true,
    attempts: 3,
  });
}

async function enqueuePipelineMatch(rawEventId) {
  await pipelineMatchQueue.add(
    "pipeline-match",
    { raw_event_id: String(rawEventId) },
    {
      removeOnComplete: true,
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 3000,
      },
    }
  );
}

export async function handleWebhookReceive(payload) {
  const { isDuplicate, rawEvent } = await createRawEvent(payload);

  if (isDuplicate) {
    return {
      success: true,
      duplicate: true,
      raw_event_id: rawEvent._id,
      message: "Duplicate webhook ignored",
    };
  }

  const updatedEvent = await fetchAndStoreHtml(rawEvent);

  if (updatedEvent.status === PIPELINE_STATUS.HTML_READY) {
    await enqueuePipelineMatch(updatedEvent._id);
  }

  await enqueueLegacyWebhook(payload);

  return {
    success: true,
    duplicate: false,
    raw_event_id: updatedEvent._id,
    status: updatedEvent.status,
    message: "Webhook processed",
  };
}
