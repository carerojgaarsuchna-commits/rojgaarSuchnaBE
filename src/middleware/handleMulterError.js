// middleware/handleMulterError.js

import multer from "multer";

export const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    // Known Multer errors
    return res.status(400).json({
      success: false,
      message: err.message,
    });
  }

  if (err) {
    // Unknown error during file upload
    return res.status(400).json({
      success: false,
      message: err.message || "File upload failed",
    });
  }

  next();
};
