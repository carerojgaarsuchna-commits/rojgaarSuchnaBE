import { Result } from "../models/Result.js";

export const getResult = async (req, res, next) => {
    try {
        // Extract query parameters (with defaults)
        const page = parseInt(req.query.page) || 1;  // current page
        const limit = parseInt(req.query.limit) || 10; // items per page

        // Calculate skip value
        const skip = (page - 1) * limit;

        // Get total count of Result
        const total = await Result.countDocuments();

        // Fetch paginated Result
        const result = await Result.find()
            .skip(skip)
            .limit(limit)
            .sort({ _id: -1 }); // latest first (optional)       
        // Prepare pagination info
        const totalPages = Math.ceil(total / limit);
        res.json({
            success: true,
            currentPage: page,
            totalPages,
            totalResults: total,
            limit,
            count: result.length,
            data: result
        });
    } catch (err) {
        next(err);
    }
};
