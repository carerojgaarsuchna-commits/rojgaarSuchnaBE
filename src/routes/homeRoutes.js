import express from "express";
import { getHomeData, getAIHomeData } from "../controllers/homeController.js";

const router = express.Router();

router.get("/", getHomeData);
router.get("/ai-home", getAIHomeData);

export default router;

