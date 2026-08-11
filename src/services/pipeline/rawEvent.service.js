import crypto from "crypto";
import { RawEvent } from "../../models/RawEvent.js";
import { PIPELINE_STATUS } from "../../constants/pipelineStatus.js";
import {
  saveArtifact,
  shouldStoreInR2,
} from "./artifactStorage.service.js";
import { fetchLatestHtmlSnapshot } from "./changeDetection.service.js";

export function buildDedupeHash(payload) {
  const diffAdded = String(payload.diff_added || "");
  const key = `${payload.watch_uuid}|${payload.change_datetime}|${diffAdded}`;
  return crypto.createHash("sha256").update(key).digest("hex");
}

export async function findRawEventByDedupeHash(dedupeHash) {
  return RawEvent.findOne({ dedupe_hash: dedupeHash }).lean();
}

export async function updateRawEventStatus(rawEventId, status, extra = {}) {
  const update = {
    $set: {
      status,
      ...extra,
    },
    $push: {
      status_history: {
        status,
        at: new Date(),
        note: extra.status_note || undefined,
      },
    },
  };

  delete update.$set.status_note;

  return RawEvent.findByIdAndUpdate(rawEventId, update, { new: true });
}

async function storeWebhookPayload(rawEventId, payload) {
  const payloadString = JSON.stringify(payload);

  if (!shouldStoreInR2(payloadString)) {
    return {
      webhook_payload: payload,
      webhook_payload_ref: undefined,
    };
  }

  const artifact = await saveArtifact({
    prefix: "webhook-payload",
    rawEventId,
    content: payloadString,
    contentType: "application/json",
    extension: "json",
  });

  return {
    webhook_payload: {
      watch_uuid: payload.watch_uuid,
      watch_title: payload.watch_title,
      watch_url: payload.watch_url,
      change_datetime: payload.change_datetime,
    },
    webhook_payload_ref: artifact.r2_key,
  };
}

export async function createRawEvent(payload) {
  const dedupeHash = buildDedupeHash(payload);
  const existing = await findRawEventByDedupeHash(dedupeHash);



  if (existing) {
    return {
      isDuplicate: true,
      rawEvent: existing,
    };
  }

  try {
    const rawEvent = await RawEvent.create({
      watch_uuid: payload.watch_uuid,
      watch_title: payload.watch_title,
      watch_url: payload.watch_url,
      change_datetime: payload.change_datetime,
      dedupe_hash: dedupeHash,
      status: PIPELINE_STATUS.RECEIVED,
      status_history: [
        {
          status: PIPELINE_STATUS.RECEIVED,
          at: new Date(),
          note: "Webhook received",
        },
      ],
      webhook_payload: payload,
    });

    const storedPayload = await storeWebhookPayload(rawEvent._id, payload);

    const updated = await RawEvent.findByIdAndUpdate(
      rawEvent._id,
      {
        $set: storedPayload,
      },
      { new: true }
    );

    return {
      isDuplicate: false,
      rawEvent: updated,
    };
  } catch (err) {
    if (err.code === 11000) {
      const duplicate = await findRawEventByDedupeHash(dedupeHash);
      return {
        isDuplicate: true,
        rawEvent: duplicate,
      };
    }

    throw err;
  }
}

export async function fetchAndStoreHtml(rawEvent) {
  const snapshotResult = await fetchLatestHtmlSnapshot({
    watchUuid: rawEvent.watch_uuid,
    changeDatetime: rawEvent.change_datetime,
  });
  if (!snapshotResult.ok) {
    return updateRawEventStatus(rawEvent._id, PIPELINE_STATUS.HTML_UNAVAILABLE, {
      status_note: snapshotResult.error,
    });
  }

  if (snapshotResult.mismatch) {
    return updateRawEventStatus(
      rawEvent._id,
      PIPELINE_STATUS.HTML_SNAPSHOT_MISMATCH,
      {
        status_note: snapshotResult.mismatchReason,
        html_snapshot: {
          snapshot_timestamp: snapshotResult.snapshotTimestamp,
          retrieval_timestamp: snapshotResult.retrievalTimestamp,
          mismatch_reason: snapshotResult.mismatchReason,
        },
      }
    );
  }

  const artifact = await saveArtifact({
    prefix: "html",
    rawEventId: rawEvent._id,
    content: snapshotResult.html,
    contentType: "text/html",
    extension: "html",
  });

  return updateRawEventStatus(rawEvent._id, PIPELINE_STATUS.HTML_READY, {
    html_snapshot: {
      r2_key: artifact.r2_key,
      fetched_at: new Date(),
      snapshot_timestamp: snapshotResult.snapshotTimestamp,
      retrieval_timestamp: snapshotResult.retrievalTimestamp,
      size_bytes: artifact.size_bytes,
    },
  });
}
