import { Admission } from '../models/Admission.js';

export const getAdmission = async (req, res, next) => {
    try {
        // Extract query parameters (with defaults)
        const page = parseInt(req.query.page) || 1;  // current page
        const limit = parseInt(req.query.limit) || 10; // items per page

        // Calculate skip value
        const skip = (page - 1) * limit;

        // Get total count of Admission
        const total = await Admission.countDocuments();

        // Fetch paginated Admission
        const admission = await Admission.find()
            .skip(skip)
            .limit(limit)
            .sort({ _id: -1 }); // latest first (optional)       
        // Prepare pagination info
        const totalPages = Math.ceil(total / limit);
        res.json({
            success: true,
            currentPage: page,
            totalPages,
            totalAdmissions: total,
            limit,
            count: admission.length,
            data: admission
        });
    } catch (err) {
        next(err);
    }
};
