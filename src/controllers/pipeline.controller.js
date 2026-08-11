/**
 * pipeline.controller.js
 * Admin API for managing the notification pipeline.
 *
 * Endpoints:
 *  GET  /api/pipeline/events              — list raw_events (paginated, filterable by status)
 *  GET  /api/pipeline/events/:id          — full event detail + artifact refs
 *  POST /api/pipeline/events/:id/approve  — enqueue publish
 *  POST /api/pipeline/events/:id/reject   — set rejected + reason
 *  PATCH /api/pipeline/events/:id         — admin edits structured fields before publish
 */

import { RawEvent } from "../models/RawEvent.js";
import { PIPELINE_STATUS } from "../constants/pipelineStatus.js";
import { updateRawEventStatus } from "../services/pipeline/rawEvent.service.js";
import pipelinePublishQueue from "../queues/pipeline-publish.queue.js";

// ─── GET /api/pipeline/events ─────────────────────────────────────────────────

export const listEvents = async (req, res, next) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const skip = (page - 1) * limit;

    const { status, watch_uuid, search } = req.query;

    const filter = {};
    if (status) filter.status = status;
    if (watch_uuid) filter.watch_uuid = watch_uuid;
    if (search) {
      filter.$or = [
        { watch_title: { $regex: search, $options: "i" } },
        { "matched_notification.title": { $regex: search, $options: "i" } },
      ];
    }

    const [total, events] = await Promise.all([
      RawEvent.countDocuments(filter),
      RawEvent.find(filter)
        .select({
          watch_uuid: 1,
          watch_title: 1,
          watch_url: 1,
          change_datetime: 1,
          status: 1,
          "matched_notification.title": 1,
          "matched_notification.score": 1,
          "matched_notification.method": 1,
          "pdf.url": 1,
          "pdf.sha256": 1,
          "pdf.size_bytes": 1,
          "quality_report.pass": 1,
          "quality_report.score": 1,
          "ai.path": 1,
          "ai.model": 1,
          "validation.pass": 1,
          "validation.errors": 1,
          "published.latest_job_id": 1,
          createdAt: 1,
          updatedAt: 1,
        })
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    const totalPages = Math.ceil(total / limit);

    return res.status(200).json({
      success: true,
      pagination: {
        currentPage: page,
        limit,
        totalRecords: total,
        totalPages,
        hasNext: page < totalPages,
        hasPrevious: page > 1,
      },
      data: events,
    });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/pipeline/events/:id ────────────────────────────────────────────

export const getEventById = async (req, res, next) => {
  try {
    const event = await RawEvent.findById(req.params.id).lean();

    if (!event) {
      return res.status(404).json({ success: false, message: "Event not found" });
    }

    return res.status(200).json({ success: true, data: event });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/pipeline/events/:id/approve ───────────────────────────────────

export const approveEvent = async (req, res, next) => {
  try {
    const event = await RawEvent.findById(req.params.id).lean();

    if (!event) {
      return res.status(404).json({ success: false, message: "Event not found" });
    }

    // Only pending_review or validation_failed events can be approved
    const approvableStatuses = [
      PIPELINE_STATUS.PENDING_REVIEW,
      PIPELINE_STATUS.VALIDATION_FAILED,
    ];

    if (!approvableStatuses.includes(event.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot approve event with status "${event.status}". Must be pending_review or validation_failed.`,
      });
    }

    // Must have validated structured data
    if (!event.validation?.structured_data) {
      return res.status(400).json({
        success: false,
        message: "Event has no validated structured_data — cannot publish. Edit fields first.",
      });
    }

    // Enqueue publish
    await pipelinePublishQueue.add(
      "pipeline-publish",
      { raw_event_id: String(event._id) },
      {
        removeOnComplete: true,
        attempts: 3,
        backoff: { type: "exponential", delay: 3000 },
      }
    );

    await updateRawEventStatus(event._id, PIPELINE_STATUS.PUBLISHING, {
      "review.approved_at": new Date(),
      "review.action": "approved",
      status_note: "Admin approved — publish queued",
    });

    return res.status(200).json({
      success: true,
      message: "Event approved and queued for publishing",
    });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/pipeline/events/:id/reject ────────────────────────────────────

export const rejectEvent = async (req, res, next) => {
  try {
    const { reason } = req.body;

    const event = await RawEvent.findById(req.params.id).lean();

    if (!event) {
      return res.status(404).json({ success: false, message: "Event not found" });
    }

    await updateRawEventStatus(event._id, PIPELINE_STATUS.REJECTED, {
      "review.rejected_at": new Date(),
      "review.action": "rejected",
      "review.reason": reason || "No reason provided",
      status_note: `Admin rejected: ${reason || "No reason provided"}`,
    });

    return res.status(200).json({
      success: true,
      message: "Event rejected",
    });
  } catch (err) {
    next(err);
  }
};

// ─── PATCH /api/pipeline/events/:id ──────────────────────────────────────────

export const editEventFields = async (req, res, next) => {
  try {
    const event = await RawEvent.findById(req.params.id).lean();

    if (!event) {
      return res.status(404).json({ success: false, message: "Event not found" });
    }

    // Only allow editing at review stages
    const editableStatuses = [
      PIPELINE_STATUS.PENDING_REVIEW,
      PIPELINE_STATUS.VALIDATION_FAILED,
    ];

    if (!editableStatuses.includes(event.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot edit event with status "${event.status}"`,
      });
    }

    // Only allow editing the structured_data fields — not pipeline internals
    const allowedFields = [
      "title",
      "original_title",
      "advertisement_no",
      "category",
      "notification_type",
      "notification_date",
      "department",
      "body",
      "total_posts",
      "qualification",
      "salary",
      "age_limit",
      "last_date",
      "important_dates",
      "apply_link",
      "summary",
      "article_html",
      "tags",
    ];

    const updates = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[`validation.structured_data.${field}`] = req.body[field];
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid fields to update",
      });
    }

    const updated = await RawEvent.findByIdAndUpdate(
      event._id,
      { $set: updates },
      { new: true }
    ).lean();

    return res.status(200).json({
      success: true,
      message: "Fields updated. Review and approve when ready.",
      data: updated?.validation?.structured_data,
    });
  } catch (err) {
    next(err);
  }
};
