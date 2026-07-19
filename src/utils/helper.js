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
    return (item.notification_key || item.title || "")
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