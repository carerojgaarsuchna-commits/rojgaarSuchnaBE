import { jobNotificationsSchema } from "../validators/jobNotificationsValidator.js";

// server/middleware/parseFormFields.js
export const parseFormFields = (req, res, next) => {
  try {
    if (!req.body) req.body = {}; // ensure body exists

    // Parse JSON fields
    if (req.body.importantDates) {
      req.body.importantDates = JSON.parse(req.body.importantDates);
    }

    if (req.body.ageLimit) {
      req.body.ageLimit = JSON.parse(req.body.ageLimit);
    }

    if (req.body.tags) {
      req.body.tags = req.body.tags.split(",").map(t => t.trim());
    }

    next();
  } catch (err) {
    res.status(400).json({
      success: false,
      message: "Invalid JSON format in fields",
    });
  }
};

export const validateLatestJob = (req, res, next) => {
  const parsed = jobNotificationsSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      errors: parsed.error.flatten(),
      message: "Validation failed",
    });
  }

  req.validatedData = parsed.data;
  next();
};
