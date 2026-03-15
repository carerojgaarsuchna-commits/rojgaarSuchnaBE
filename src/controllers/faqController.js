import { Faq } from "../models/Faq.js";

export const getFaq = async (req, res, next) => {
    try {
        // Extract query parameters (with defaults)
        const page = parseInt(req.query.page) || 1;  // current page
        const limit = parseInt(req.query.limit) || 10; // items per page

        // Calculate skip value
        const skip = (page - 1) * limit;

        // Get total count of Faq
        const total = await Faq.countDocuments();

        // Fetch paginated Faq
        const Faqs = await Faq.find()
            .skip(skip)
            .limit(limit)
            .sort({ _id: -1 }); // latest first (optional)       
        // Prepare pagination info
        const totalPages = Math.ceil(total / limit);
        res.json({
            success: true,
            currentPage: page,
            totalPages,
            totalFaqs: total,
            limit,
            count: Faqs.length,
            data: Faqs
        });
    } catch (err) {
        next(err);
    }
};
