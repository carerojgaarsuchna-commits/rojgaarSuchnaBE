import express from "express";
import { getAnswerKeys } from "../controllers/answerKeyController.js";

const router = express.Router();

router.get("/", getAnswerKeys);

export default router;
