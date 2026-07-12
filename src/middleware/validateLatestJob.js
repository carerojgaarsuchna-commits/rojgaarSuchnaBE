import { jobNotificationsSchema } from "../validators/jobNotificationsValidator.js";
import { latestJobsAIPromptSchema } from "../validators/latestJobsAIPromptValidator.js";

// server/middleware/parseFormFields.js
export const parseFormFields = (req, res, next) => {
  try {
    if (!req.body) req.body = {}; // ensure body exists

    // console.log("[parseFormFields] method:", req.method, "path:", req.originalUrl);
    // console.log("[parseFormFields] raw body keys:", Object.keys(req.body));

    const parseJsonField = (value) => {
      if (value === undefined || value === null || value === "") {
        return undefined;
      }

      if (typeof value === "string") {
        return JSON.parse(value);
      }

      return value;
    };

    // Parse JSON fields
    if (req.body.importantDates) {
      req.body.importantDates = parseJsonField(req.body.importantDates);
    }

    if (req.body.ageLimit) {
      req.body.ageLimit = parseJsonField(req.body.ageLimit);
    }

    if (req.body.tags) {
      req.body.tags = Array.isArray(req.body.tags)
        ? req.body.tags
        : req.body.tags.split(",").map(t => t.trim());
    }

    // console.log("[parseFormFields] parsed body:", req.body);

    next();
  } catch (err) {
    console.error("[parseFormFields] failed to parse body:", err.message);
    res.status(400).json({
      success: false,
      message: "Invalid JSON format in fields",
    });
  }
};

export const validateLatestJob = (req, res, next) => {
  // console.log("[validateLatestJob] body before validation:", req.body);
  const parsed = jobNotificationsSchema.safeParse(req.body);

  if (!parsed.success) {
    console.error(
      "[validateLatestJob] validation failed:",
      parsed.error.flatten()
    );
    return res.status(400).json({
      success: false,
      errors: parsed.error.flatten(),
      message: "Validation failed",
    });
  }

  // console.log("[validateLatestJob] validation passed");
  req.validatedData = parsed.data;
  next();
};

export const validateLatestJobAIPrompt = (req, res, next) => {
  const parsed = latestJobsAIPromptSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      errors: parsed.error.flatten(),
      message: "Validation failed"
    })
  }
  req.validatedData = parsed.data;
  next();
}
