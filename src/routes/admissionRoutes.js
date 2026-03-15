import express from "express";
import { getAdmission } from "../controllers/admissionController.js";

const router = express.Router();

router.get("/", getAdmission);

export default router;
