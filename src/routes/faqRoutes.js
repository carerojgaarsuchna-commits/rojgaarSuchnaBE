import express from "express";
import { getFaq } from "../controllers/faqController.js";

const router = express.Router();

router.get("/", getFaq);

export default router;
