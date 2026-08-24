import { LatestNotification } from "../models/LatestNotification.js";
import webhookQueue from "../queues/webhook.queue.js";
import { createRawEvent } from "../services/pipeline/rawEvent.service.js";
import { stripSecretFromPayload, buildEventHash } from "../service/webhook.service.js";
import { updateRawEventStatus } from "../services/pipeline/rawEvent.service.js";
import { PIPELINE_STATUS } from "../constants/pipelineStatus.js";

/**
 * Fast Webhook Receiver Controller (<100ms response time).
 *
 * Secret authentication is handled upstream by verifyWebhook middleware
 * using WEBHOOK_SECRET env variable. No duplicate check here.
 *
 * 1. Strips secret key from payload to protect credentials.
 * 2. Calculates event_hash and checks for early duplicate webhooks.
 * 3. Logs raw event to Database.
 * 4. Pushes payload to BullMQ 'webhook' queue.
 * 5. Immediately responds 200 OK to changedetection.io.
 */
const receiveChange = async (req, res) => {
    try {
        const rawPayload = req.body || {};

        // Step 1: Strip secret key from payload before storage & queueing
        // Secret authentication is already done by verifyWebhook middleware (WEBHOOK_SECRET).
        const safePayload = stripSecretFromPayload(rawPayload);

        // Step 2: Calculate SHA-256 event hash for early deduplication
        const eventHash = buildEventHash(
            safePayload.watch_uuid,
            safePayload.change_datetime,
            safePayload.diff_added
        );
        safePayload.event_hash = eventHash;

        // Step 3: Early deduplication check via RawEvent model (L1 dedup)
        const { isDuplicate, rawEvent } = await createRawEvent(safePayload);

        if (isDuplicate) {
            console.log(`🔁 [Webhook] Duplicate webhook ignored: hash=${eventHash}`);
            return res.status(200).json({
                success: true,
                message: "Duplicate webhook ignored",
                data: {
                    status: "ignored_duplicate",
                    event_hash: eventHash,
                },
            });
        }

        // Step 4: Enqueue payload into BullMQ — include rawEventId so the worker
        // can update the RawEvent status throughout the pipeline lifecycle
        const jobPayload = {
            ...safePayload,
            rawEventId: rawEvent._id.toString(),
        };

        await webhookQueue.add("process-webhook", jobPayload, {
            attempts: 3,
            backoff: {
                type: "exponential",
                delay: 5000,
            },
            removeOnComplete: 100,
            // removeOnFail: 500,
        });

        // Mark RawEvent as queued now that the job is in BullMQ
        await updateRawEventStatus(rawEvent._id, PIPELINE_STATUS.MATCHING, {
            status_note: "Webhook queued for AI processing",
        });

        console.log(`📥 [Webhook] Queued for Watch: ${safePayload.watch_title || safePayload.watch_uuid}`);

        // Step 5: Instant HTTP 200 OK Response (<100ms)
        return res.status(200).json({
            success: true,
            message: "Webhook received and queued successfully",
            data: {
                raw_event_id: rawEvent._id,
                status: "queued",
                event_hash: eventHash,
            },
        });
    } catch (err) {
        console.error("❌ [Webhook Controller] receiveChange failed:", err.message);
        return res.status(500).json({
            success: false,
            message: `Webhook processing error: ${err.message}`,
        });
    }
};

const getLetestNotifications = async (req, res, next) => {
    try {
        const page = Math.max(Number(req.query.page) || 1, 1);
        const limit = Math.min(
            Math.max(Number(req.query.limit) || 10, 1),
            100
        );

        const skip = (page - 1) * limit;

        const {
            category,
            body,
            department,
            search,
            status = "pending_review",
            publish,
            notification_type,
        } = req.query;

        const filter = {};

        if (status) filter.status = status;
        if (category) filter.category = category;
        if (body) filter.body = body;
        if (department) filter.department = department;
        if (notification_type) filter.notification_type = notification_type;

        if (publish !== undefined) {
            filter.publish = publish === "true";
        }

        if (search) {
            filter.$or = [
                { title: { $regex: search, $options: "i" } },
                { summary: { $regex: search, $options: "i" } },
                { department: { $regex: search, $options: "i" } },
                { body: { $regex: search, $options: "i" } },
            ];
        }

        const [total, notifications] = await Promise.all([
            LatestNotification.countDocuments(filter),
            LatestNotification.find(filter)
                .select({
                    title: 1,
                    original_title: 1,
                    slug: 1,
                    summary: 1,
                    markdown_body: 1,
                    pdf_url: 1,
                    body: 1,
                    department: 1,
                    category: 1,
                    notification_type: 1,
                    notification_date: 1,
                    source_url: 1,
                    publish: 1,
                    status: 1,
                    createdAt: 1,
                    updatedAt: 1,
                })
                .sort({ createdAt: -1, _id: -1 })
                .skip(skip)
                .limit(limit)
                .lean()
                .exec(),
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
            data: notifications,
        });

    } catch (err) {
        next(err);
    }
};

export const getLetestNotificationBySlug = async (req, res, next) => {
    try {
        const { slug } = req.params;

        const job = await LatestNotification.findOne({ slug }).select(
            "title original_title pdf_url slug summary markdown_body category notification_type notification_date department body source_url views ai_response createdAt updatedAt"
        ).lean();;

        if (!job) {
            return res.status(404).json({
                success: false,
                message: "Notification not found",
            });
        }

        // increment views
        await LatestNotification.updateOne(
            { slug },
            { $inc: { views: 1 } }
        );

        job.views += 1;

        res.json({
            success: true,
            data: {
                ...job,
                ai_response: {
                    items: job.ai_response?.items?.map(item => ({
                        title: item.title,
                        summary: item.summary,
                        category: item.category,
                        notification_type: item.notification_type,
                        notification_date: item.notification_date,
                        source_url: item.source_url,
                        department: item.department,
                        body: item.body,
                        new_or_updated: item.new_or_updated,
                    })) || [],
                },
            },
        });
    } catch (err) {
        next(err);
    }
};

const letestNotificationSitemap = async (req, res, next) => {
    try {
        const page = Math.max(Number(req.query.page) || 1, 1);
        const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 1000);

        const skip = (page - 1) * limit;

        const filter = {};

        const [data, totalRecords] = await Promise.all([
            LatestNotification.find(filter)
                .select({ slug: 1, category: 1, updatedAt: 1 })
                .sort({ _id: 1 })
                .skip(skip)
                .limit(limit)
                .lean(),

            LatestNotification.countDocuments(filter),
        ]);

        return res.status(200).json({
            success: true,
            pagination: {
                currentPage: page,
                limit,
                totalRecords,
                totalPages: Math.ceil(totalRecords / limit),
                hasNext: page * limit < totalRecords,
                hasPrevious: page > 1,
            },
            data,
        });
    } catch (error) {
        next(error);
    }
};

export default {
    receiveChange,
    getLetestNotifications,
    getLetestNotificationBySlug,
    letestNotificationSitemap,
};