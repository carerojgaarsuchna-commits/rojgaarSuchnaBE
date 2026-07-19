import webhookQueue from "../queues/webhook.queue.js"
import { LatestNotification } from "../models/LatestNotification.js"
const receiveChange = async (req, res) => {
    try {
        await webhookQueue.add(
            "process-webhook",
            req.body, {
            removeOnComplete: true,
            attempts: 3
        }
        );

        const counts = await webhookQueue.getJobCounts(
            "waiting",
            "active",
            "completed",
            "failed"
        );

        console.log(counts);
        return res.status(200).json({
            success: true,
            message: "Webhook received",
            // data: result
        });


    } catch (err) {
        return res.status(500).json({
            status: false,
            message: err.message
        })
    }
}

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
                {
                    title: {
                        $regex: search,
                        $options: "i",
                    },
                },
                {
                    summary: {
                        $regex: search,
                        $options: "i",
                    },
                },
                {
                    department: {
                        $regex: search,
                        $options: "i",
                    },
                },
                {
                    body: {
                        $regex: search,
                        $options: "i",
                    },
                },
            ];
        }

        const [total, notifications] = await Promise.all([
            LatestNotification.countDocuments(filter),

            LatestNotification.find(filter)
                .select({
                    title: 1,
                    slug: 1,
                    summary: 1,
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
                .sort({
                    createdAt: -1,
                    _id: -1,
                })
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


export default {
    receiveChange,
    getLetestNotifications
}