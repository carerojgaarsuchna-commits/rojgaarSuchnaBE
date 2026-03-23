import express from "express";
import { getLatestJobs, getLatestJobBySlug, createLatestJob, updateLatestJob, deleteLatestJob, getAIGeneratedLatestJob } from "../controllers/latestJobController.js";
import { parseFormFields, validateLatestJob } from "../middleware/validateLatestJob.js";
import { upload } from "../utils/multerConfig.js";
import { handleMulterError } from "../middleware/handleMulterError.js";
const router = express.Router();

router.get("/list", getLatestJobs);
router.get("/ai-jobs", getAIGeneratedLatestJob);
router.get("/:slug", getLatestJobBySlug);
router.post(
  "/",
  (req, res, next) => {
    upload.single("notificationPdf")(req, res, (err) => {
      if (err) return handleMulterError(err, req, res, next);
      next();
    });
  },

  // File path setter
  (req, res, next) => {
    if (req.file) {
      req.body.notificationPdf = `/uploads/pdfs/${req.file.filename}`;
    }
    next();
  },
  parseFormFields,
  validateLatestJob,
  createLatestJob
);

router.put(
  "/:slug",
  (req, res, next) => {
    upload.single("notificationPdf")(req, res, (err) => {
      if (err) return handleMulterError(err, req, res, next);
      next();
    });
  },

  // File path setter
  (req, res, next) => {
    if (req.file) {
      req.body.notificationPdf = `/uploads/pdfs/${req.file.filename}`;
    }
    next();
  },
  parseFormFields,
  validateLatestJob,
  updateLatestJob
);
router.delete("/:slug", deleteLatestJob);

export default router;
