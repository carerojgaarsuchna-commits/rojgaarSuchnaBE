import express from "express";
import {
  getBodies,
  getBodyById,
  createBody,
  updateBody,
  getBodiesByDepartment
} from "../controllers/bodiesController.js";
import { upload} from "../utils/multerConfig.js"; 
import { handleMulterError } from "../middleware/handleMulterError.js"; 
const router = express.Router();

// list all bodies
router.get("/list", getBodies);

// get body by slug
router.get("/:slug", getBodyById); // logo used as param 

router.get("/list/:slug", getBodiesByDepartment); // fetch by department slug 

// update body 
router.put("/",
  // Upload logo using Multer
  (req, res, next) => {
    upload.single("logo")(req, res, (err) => {
      if (err) return handleMulterError(err, req, res, next);
      next();
    });
  },

  //  Set logo path in req.body
  (req, res, next) => {
    if (req.file) {
      req.body.logo = `/uploads/logos/${req.file.filename}`;
    }
    next();
  },
  updateBody);

// create body
router.post("/",
  // Upload logo using Multer
  (req, res, next) => {
    upload.single("logo")(req, res, (err) => {
      if (err) return handleMulterError(err, req, res, next);
      next();
    });
  },

  //  Set logo path in req.body
  (req, res, next) => {
    if (req.file) {
      req.body.logo = `/uploads/logos/${req.file.filename}`;
    }
    next();
  }, createBody);

export default router;
