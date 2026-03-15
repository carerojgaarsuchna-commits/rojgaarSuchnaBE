import { Document } from '../models/Document.js';

export const getDocuments = async (req, res, next) => {
    try {
        // Extract query parameters (with defaults)
        const page = parseInt(req.query.page) || 1;  // current page
        const limit = parseInt(req.query.limit) || 10; // items per page

        // Calculate skip value
        const skip = (page - 1) * limit;

        // Get total count of documents
        const total = await Document.countDocuments();

        // Fetch paginated documents
        const documents = await Document.find()
            .skip(skip)
            .limit(limit)
            .sort({ _id: -1 }); // latest first (optional)       
        // Prepare pagination info
        const totalPages = Math.ceil(total / limit);
        res.json({
            success: true,
            currentPage: page,
            totalPages,
            totalDocuments: total,
            limit,
            count: documents.length,
            data: documents
        });
    } catch (err) {
        next(err);
    }
};
