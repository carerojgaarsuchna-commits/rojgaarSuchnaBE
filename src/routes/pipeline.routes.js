import express from "express";
import {
  listEvents,
  getEventById,
  approveEvent,
  rejectEvent,
  editEventFields,
} from "../controllers/pipeline.controller.js";

const router = express.Router();

// List all raw_events (paginated, filter by status/watch_uuid/search)
router.get("/events", listEvents);

// Full detail of a single raw_event
router.get("/events/:id", getEventById);

// Admin actions
router.post("/events/:id/approve", approveEvent);
router.post("/events/:id/reject", rejectEvent);
router.patch("/events/:id", editEventFields);

export default router;
