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