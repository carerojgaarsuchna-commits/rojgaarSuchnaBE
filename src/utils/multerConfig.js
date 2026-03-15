import multer from "multer";
import path from "path";
import { departmentSlugify } from "./helper.js";
import fs from "fs";

/**
 * Storage logic based on field name
 */
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    let uploadPath = "";

    if (file.fieldname === "logo") {
      uploadPath = "uploads/logos";
    } else if (file.fieldname === "pdf") {
      uploadPath = "uploads/pdfs";
    } else {
      return cb(new Error("Invalid file field"), null);
    }

    // ✅ Create directory if it does not exist
    fs.mkdirSync(uploadPath, { recursive: true });

    cb(null, uploadPath);
  },

  filename: (req, file, cb) => {
    const name = req.body?.name || "department";
    const slug = departmentSlugify(name);

    cb(null, `${slug}${path.extname(file.originalname)}`);
  },
});

/**
 * File validation
 */
const fileFilter = (req, file, cb) => {
  // ✅ PDF
  if (file.fieldname === "pdf") {
    if (file.mimetype === "application/pdf") {
      return cb(null, true);
    }
    return cb(new Error("Only PDF files are allowed"), false);
  }

  // ✅ Logo (image)
  if (file.fieldname === "logo") {
    const allowed = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
    if (allowed.includes(file.mimetype)) {
      return cb(null, true);
    }
    return cb(new Error("Only image files are allowed for logo"), false);
  }

  cb(new Error("Invalid upload field"), false);
};

/**
 * Multer instance
 */
export const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
  fileFilter,
});
