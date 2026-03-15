import { PutObjectCommand } from "@aws-sdk/client-s3";
import { r2 } from "../config/r2.js";
import multer from "multer";
import dotenv from "dotenv";
import crypto from "crypto";
dotenv.config();

const storage = multer.memoryStorage();
export const upload = multer({ storage });

export const uploadToR2 = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });

    const fileKey = crypto.randomUUID() + "-" + req.file.originalname;

    await r2.send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: fileKey,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
      })
    );

    const publicUrl = `${process.env.R2_ENDPOINT}/${process.env.R2_BUCKET_NAME}/${fileKey}`;

    res.json({
      message: "✅ File uploaded successfully",
      url: publicUrl,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Upload failed", error: err.message });
  }
};
