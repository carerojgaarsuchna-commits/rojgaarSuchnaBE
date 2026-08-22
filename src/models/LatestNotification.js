import mongoose from "mongoose";
import { ALLOWED_NOTIFICATION_CATEGORIES } from "../utils/notificationCategory.js";

const LatestNotificationSchema = new mongoose.Schema(
  {
    // Source Information
    watch_uuid: {
      type: String,
      required: true,
    },

    // Link back to the RawEvent that produced this notification (for audit trail)
    source_event_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RawEvent",
      index: true,
    },

    source_url: {
      type: String,
      required: true,
      trim: true,
    },

    // Official PDF document link (extracted by AI from webhook diff/HTML)
    pdf_url: {
      type: String,
      trim: true,
    },

    // AI-generated full blog article in Markdown format (for direct frontend rendering)
    markdown_body: {
      type: String,
      trim: true,
    },

    body: {
      type: String,
      required: true,
      trim: true,
    },

    department: {
      type: String,
      trim: true,
    },

    // LatestNotification Information
    title: {
      type: String,
      required: true,
      trim: true,
    },
    original_title: {
      type: String,
    },

    slug: {
      type: String,
      trim: true,
    },

    summary: {
      type: String,
      trim: true,
    },

    category: {
      type: String,
      enum: ALLOWED_NOTIFICATION_CATEGORIES,
      required: true,
    },

    notification_type: {
      type: String,
      trim: true,
      default: "Other",
    },

    notification_date: {
      type: Date,
    },

    notification_date_raw: {
      type: String,
      trim: true,
    },

    // Last date for candidates to apply (distinct from notification publication date)
    application_last_date: {
      type: Date,
    },

    application_last_date_raw: {
      type: String,
      trim: true,
    },

    new_or_updated: {
      type: String,
      enum: ["New", "Updated"],
      default: "New",
    },

    // Publishing
    publish: {
      type: Boolean,
      default: true,
    },

    status: {
      type: String,
      enum: [
        "pending_review",
        "published",
        "rejected",
        "duplicate",
      ],
      default: "pending_review",
    },

    // Deduplication
    dedupe_hash: {
      type: String,
      required: true,
    },

    // AI Metadata
    ai: {
      confidence: {
        type: Number,
        min: 0,
        max: 100,
        required: true,
      },

      explanation: {
        type: String,
      },

      model: {
        type: String,
      },

      extracted_at: {
        type: Date,
        default: Date.now,
      },
    },

    // Store original webhook for debugging
    webhook_payload: {
      type: mongoose.Schema.Types.Mixed,
    },
    views: { type: Number, default: 0 },
    // Optional: full AI response
    ai_response: {
      type: mongoose.Schema.Types.Mixed,
    },

    // Evidence traceability — which part of the diff grounded this notification
    source_evidence: {
      evidence_source: {
        type: String,
        enum: ["diff_added", "diff", "fallback", "unknown"],
        default: "unknown",
      },
      matched_token: { type: String },
      score:         { type: Number },
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Useful Indexes
LatestNotificationSchema.index({ dedupe_hash: 1 }, { unique: true });
LatestNotificationSchema.index(
    { slug: 1 },
    // { unique: true }
);
LatestNotificationSchema.index({
    watch_uuid: 1,
    createdAt: -1,
});

LatestNotificationSchema.index({
    status: 1,
    publish: 1,
    notification_date: -1,
});

LatestNotificationSchema.index({
    category: 1,
    notification_date: -1,
});

LatestNotificationSchema.index({
    body: 1,
    notification_date: -1,
});

LatestNotificationSchema.index({
    department: 1,
    notification_date: -1,
});

LatestNotificationSchema.index({
    createdAt: -1,
});

LatestNotificationSchema.index({
    title: "text",
    summary: "text",
    department: "text",
});

export const LatestNotification = mongoose.model("LatestNotification", LatestNotificationSchema);
