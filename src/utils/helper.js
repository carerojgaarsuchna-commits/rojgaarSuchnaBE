import { ALLOWED_NOTIFICATION_CATEGORIES } from "./notificationCategory.js";

// utils/slugify.js
import axios from "axios";

export const departmentSlugify = (text = "") =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s&()-]/g, "")
    .replace(/\s+&\s+/g, " and ")
    .replace(/[\s()+]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/(^-|-$)/g, "");
    
// Helper — Check if image exists (HEAD request)
export const checkImageExists = async (url) => {
  try {
    const res = await axios.head(url);
    return await res.status === 200;
  } catch (err) {
    console.log('--error-----', err);
    return false;
  }
};


export function extractMarkdownTitle(content) {
  if (!content) return undefined;
  const match = content.match(/^\s*#\s+(.+?)\s*$/m);
  return match?.[1]?.trim();
}

export function buildSlug(item) {
    return (item.title || "")
        .toLowerCase()
        .replace(/[^a-z0-9\s&()-]/g, "")
        .replace(/\s+&\s+/g, " and ")
        .replace(/[\s()+]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/(^-|-$)/g, "");
}

export async function generateUniqueSlug(baseSlug, Model) {
    let slug = baseSlug;

    const existing = await Model.find({
        slug: new RegExp(`^${baseSlug}(-\\d+)?$`, "i")
    }).select("slug");

    if (!existing.length) {
        return slug;
    }

    const used = new Set(existing.map(x => x.slug));

    let counter = 2;

    while (used.has(slug)) {
        slug = `${baseSlug}-${counter++}`;
    }

    return slug;
}



export function isValidAIResponse(data) {
  if (!data || typeof data !== "object") return false;

  // Top level
  if (typeof data.relevant !== "boolean") return false;

  if (!data.relevant) {
    return typeof data.reason === "string" && data.reason.trim().length > 0;
  }

  if (!data.watch_uuid || typeof data.watch_uuid !== "string") return false;

  if (!Array.isArray(data.items) || data.items.length === 0) return false;

  for (const item of data.items) {
    if (!item || typeof item !== "object") return false;

    // Required string fields
    const requiredStrings = [
      "title",
      "original_title",
      "summary",
      "source_url",
      "body",
      "department",
      "category",
      "notification_type",
      "notification_date",
      "new_or_updated",
      "raw_explanation",
    ];

    for (const field of requiredStrings) {
      if (
        typeof item[field] !== "string" ||
        item[field].trim().length === 0
      ) {
        return false;
      }
    }

    // Category
    if (!ALLOWED_NOTIFICATION_CATEGORIES.includes(item.category)) {
      return false;
    }

    // New / Updated
    if (!["New", "Updated"].includes(item.new_or_updated)) {
      return false;
    }

    // Confidence
    if (
      typeof item.confidence !== "number" ||
      item.confidence < 0 ||
      item.confidence > 100
    ) {
      return false;
    }

    // Date (YYYY-MM-DD)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(item.notification_date)) {
      return false;
    }

    // URL
    try {
      new URL(item.source_url);
    } catch {
      return false;
    }
  }

  return true;
}