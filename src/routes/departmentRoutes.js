import express from "express";
import { getDepartments, getDepartmentById, updateDepartment, createDepartment } from "../controllers/departmentController.js";
import { upload } from "../utils/multerConfig.js";
import { handleMulterError } from "../middleware/handleMulterError.js";

const router = express.Router();
// list all departments
router.get("/list", getDepartments);
//get by id
router.get("/:slug", getDepartmentById);// logo used as param
//update department
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
  updateDepartment);
//create department
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
  },

  createDepartment);

export default router;
