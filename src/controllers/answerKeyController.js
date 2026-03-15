import { AnswerKey } from '../models/AnswerKey.js';

export const getAnswerKeys = async (req, res, next) => {
  try {

    // Extract query parameters (with defaults)
    const page = parseInt(req.query.page) || 1;  // current page
    const limit = parseInt(req.query.limit) || 10; // items per page

    // Calculate skip value
    const skip = (page - 1) * limit;

    // Get total count of AnswerKey
    const total = await AnswerKey.countDocuments();

    // Fetch paginated answerKey
    const answerKey = await AnswerKey.find()
      .skip(skip)
      .limit(limit)
      .sort({ _id: -1 }); // latest first (optional)       
    // Prepare pagination info
    const totalPages = Math.ceil(total / limit);
    res.json({
      success: true,
      currentPage: page,
      totalPages,
      totalAnswerKeys: total,
      limit,
      count: answerKey.length,
      data: answerKey
    });
  } catch (err) {
    next(err);
  }
};
