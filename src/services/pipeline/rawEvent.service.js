import crypto from "crypto";
import { RawEvent } from "../../models/RawEvent.js";
import { PIPELINE_STATUS } from "../../constants/pipelineStatus.js";

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

    return {
      isDuplicate: false,
      rawEvent,
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
