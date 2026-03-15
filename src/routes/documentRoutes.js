import express from "express";
import { getDocuments } from "../controllers/documentController.js";

const router = express.Router();

router.get("/", getDocuments);

export default router;
