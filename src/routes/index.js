import express from "express";
import homeRoutes from "./homeRoutes.js";
import answerKeyRoutes from "./answerKeyRoutes.js";
import documentRoutes from "./documentRoutes.js";
import admitCardRoutes from "./admitCardRoutes.js";
import resultRoutes from "./resultRoutes.js";
import jobNotificationsValidatorRoutes from "./jobNotificationsValidatorRoutes.js";
import admissionRoutes from "./admissionRoutes.js";
import faqRoutes from "./faqRoutes.js";
import departmentRoutes from "./departmentRoutes.js";
import bodiesRoutes from "./bodiesRoutes.js";
import promptByAi from "./promptByAi.js"
import webhookRoutes from "./webhook.routes.js"
import pipelineRoutes from "./pipeline.routes.js"
const router = express.Router();

router.use("/home", homeRoutes);
router.use("/answer-keys", answerKeyRoutes);
router.use("/documents", documentRoutes);
router.use("/admit-cards", admitCardRoutes);
router.get("/results", resultRoutes);
router.use("/job-notifications", jobNotificationsValidatorRoutes);
router.use("/admissions", admissionRoutes);
router.use("/faqs", faqRoutes);
router.use("/department", departmentRoutes);    
router.use("/bodies", bodiesRoutes);
router.use('/promptbyai', promptByAi)
//webhook change deduction
router.use("/webhook",webhookRoutes) 
// pipeline admin
router.use("/pipeline", pipelineRoutes)

export default router;
