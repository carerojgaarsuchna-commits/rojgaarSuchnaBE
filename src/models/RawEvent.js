import mongoose from "mongoose";
import { PIPELINE_STATUS_LIST } from "../constants/pipelineStatus.js";

const StatusHistorySchema = new mongoose.Schema(
  {
    status: { type: String, required: true },
    at: { type: Date, default: Date.now },
    note: { type: String },
  },
  { _id: false }
);

const RawEventSchema = new mongoose.Schema(
  {
    watch_uuid: { type: String, required: true, index: true },
    watch_title: { type: String, trim: true },
    watch_url: { type: String, trim: true },
    change_datetime: { type: String },

    dedupe_hash: { type: String, required: true, unique: true },

    status: {
      type: String,
      enum: PIPELINE_STATUS_LIST,
      default: "received",
      index: true,
    },
    status_history: [StatusHistorySchema],

    webhook_payload: { type: mongoose.Schema.Types.Mixed },
    webhook_payload_ref: { type: String },

    html_snapshot: {
      r2_key: { type: String },
      fetched_at: { type: Date },
      snapshot_timestamp: { type: String },
      retrieval_timestamp: { type: Date },
      size_bytes: { type: Number },
      mismatch_reason: { type: String },
    },

    matched_notification: { type: mongoose.Schema.Types.Mixed },
    pdf: { type: mongoose.Schema.Types.Mixed },
    extracted_text: { type: mongoose.Schema.Types.Mixed },
    quality_report: { type: mongoose.Schema.Types.Mixed },
    ai: { type: mongoose.Schema.Types.Mixed },
    validation: { type: mongoose.Schema.Types.Mixed },
    review: { type: mongoose.Schema.Types.Mixed },
    published: { type: mongoose.Schema.Types.Mixed },

    retry: {
      count: { type: Number, default: 0 },
      last_error: { type: String },
      last_at: { type: Date },
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

RawEventSchema.index({ watch_uuid: 1, createdAt: -1 });
RawEventSchema.index({ status: 1, createdAt: -1 });

export const RawEvent = mongoose.model("RawEvent", RawEventSchema);
