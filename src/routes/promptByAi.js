import express from 'express'
import { validateLatestJobAIPrompt } from '../middleware/validateLatestJob.js';
import { promptAILatestJob } from '../controllers/latestJobController.js';
const router = express.Router();

router.post(
  "/",
  validateLatestJobAIPrompt,
  promptAILatestJob
);
export default router;
