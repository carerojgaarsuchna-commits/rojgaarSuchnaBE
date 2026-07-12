import mongoose from "mongoose";

const LatestNotificationSchema = new mongoose.Schema(
  {
    // Source Information
    watch_uuid: {
      type: String,
      required: true,
      index: true,
    },

    source_url: {
      type: String,
      required: true,
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

    slug: {
      type: String,
      trim: true,
      index: true,
    },

    summary: {
      type: String,
      trim: true,
    },

    category: {
      type: String,
      enum: [
        "Job Vacancy",
        "Result",
        "Admit Card",
        "Answer Key",
        "Admission",
        "Syllabus",
        "Notice",
        "Tender",
        "Other",
      ],
      required: true,
      index: true,
    },

    notification_type: {
      type: String,
      trim: true,
      default: "Other",
    },

    notification_date: {
      type: Date,
      index: true,
    },

    notification_date_raw: {
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
      index: true,
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
      index: true,
    },

    // Deduplication
    dedupe_hash: {
      type: String,
      required: true,
      index: true,
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

    // Optional: full AI response
    ai_response: {
      type: mongoose.Schema.Types.Mixed,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Useful Indexes
LatestNotificationSchema.index({ watch_uuid: 1, createdAt: -1 });
LatestNotificationSchema.index({ category: 1, notification_date: -1 });
LatestNotificationSchema.index({ status: 1, publish: 1 });
LatestNotificationSchema.index({ body: 1, notification_date: -1 });

export const LatestNotification = mongoose.model("LatestNotification", LatestNotificationSchema);