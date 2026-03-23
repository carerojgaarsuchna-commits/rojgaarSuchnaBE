// server/models/LatestJob.js
import mongoose from "mongoose";

const LatestJobSchema = new mongoose.Schema(
  {
    // === CORE JOB INFO ===
    title: {
      type: String,
      required: true,
      trim: true,
    },
    slug: {
      type: String,
      unique: true,
      index: true,
    },

    // === ORGANIZATION & LINKS ===
    applyLink: { type: String },
    officialWebsite: { type: String },
    notificationPdf: { type: String }, // e.g., "/uploads/ssc-constable-2025.pdf"

    // === REFERENCES (Your existing DB) ===
    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Department",
      required: true,
    },
    body: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Bodies",
      required: true,
    },

    // === JOB DETAILS ===
    postName: { type: String }, // "Constable", "Clerk"
    totalPosts: { type: Number },
    qualification: { type: String }, // "10th Pass", "Graduate"
    salary: { type: String }, // "₹25,500 - ₹81,100"
    lastDate: { type: String }, // "31 Oct 2025"

    // === IMPORTANT DATES (Flexible Array) ===
    importantDates: [
      {
        label: { type: String, required: true }, // "Apply Start"
        date: { type: String },                  // "22 Sep 2025"
        timestamp: { type: Date },               // Auto-filled
      },
    ],

    // === AGE LIMIT ===
    ageLimit: {
      min: { type: Number },
      max: { type: Number },
      asOn: { type: String }, // "01/07/2025"
      relaxation: { type: String },
    },

    // === RICH CONTENT (ReactQuill HTML) ===
    // Supports: Text, Tables, Images, Links, PDFs
    content: {
      type: String,
      required: true,
    },
    blogTxt: {
      type: String,
      trim: true,
    },
    shortDescription: {
      type: String,
      maxlength: 300,
    },

    // === TYPE & CATEGORY ===
    type: {
      type: String,
      enum: [
        "latest-jobs",
        "results",
        "admit-cards",
        "answer-keys",
        "syllabus",
        "documents",
        "scheme",
        "scholarship",
        "notice",
        "admissions"
      ],
      default: "latest-jobs",
    },

    // === SEO & ENGAGEMENT ===
    tags: [{ type: String }], // ["10th Pass", "Delhi Police", "7565 Posts"]
    isFeatured: { type: Boolean, default: false },
    views: { type: Number, default: 0 },
    seo: { type: String, default: "" },
    shares: { type: Number, default: 0 },

    // === APP PROMOTION ===
    showAppPromo: { type: Boolean, default: true },
    appLinks: {
      whatsapp: { type: String },
      telegram: { type: String },
      android: { type: String },
      ios: { type: String },
    },

    // === STATUS & TIMESTAMPS ===
    status: {
      type: String,
      enum: ["active", "expired", "draft"],
      default: "active",
    },
    publishedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date }, // Auto-set to lastDate + 30 days
     isAIGenerated: {
      type: Boolean,
      default: false
      },
  },
  { timestamps: true }
);

// === INDEXES FOR PERFORMANCE ===
LatestJobSchema.index({ department: 1, body: 1 });
LatestJobSchema.index({ category: 1, type: 1 });
LatestJobSchema.index({ "importantDates.timestamp": 1 });
LatestJobSchema.index({ tags: 1 });
LatestJobSchema.index({ title: "text", shortDescription: "text", content: "text" });

// === MIDDLEWARE: Auto-generate slug, short desc, timestamps ===
LatestJobSchema.pre("save", function (next) {
  // Generate slug
  if (this.isModified("title") || !this.slug) {
    this.slug = this.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 100);
  }

  // Auto-fill shortDescription
  if (this.isModified("content")) {
    const plainText = this.content.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    this.shortDescription = plainText.substring(0, 280) + (plainText.length > 280 ? "..." : "");
  }

  // Parse important dates
  this.importantDates = this.importantDates.map((d) => {
    if (d.date) {
      const parsed = new Date(d.date);
      d.timestamp = isNaN(parsed) ? null : parsed;
    }
    return d;
  });

  // Auto-set expiresAt (30 days after last date)
  if (this.lastDate && !this.expiresAt) {
    const last = new Date(this.lastDate);
    if (!isNaN(last)) {
      this.expiresAt = new Date(last.getTime() + 30 * 24 * 60 * 60 * 1000);
    }
  }

  next();
});

export const LatestJob = mongoose.model("LatestJob", LatestJobSchema);
