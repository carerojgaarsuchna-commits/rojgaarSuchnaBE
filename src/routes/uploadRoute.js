import express from "express";
import { upload, uploadToR2 } from "../controllers/uploadController.js";

const router = express.Router();

router.post("/upload", upload.single("file"), uploadToR2);

export default router;
