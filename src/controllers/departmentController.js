import { Department } from "../models/Department.js";
import { createDepartmentSchema } from "../validators/departmentValidator.js";
import axios from "axios";
import { checkImageExists } from "../utils/helper.js";
export const getDepartments = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const search = req.query.search?.trim() || '';

    // Build the match condition correctly
    const matchStage = search
      ? {
        $or: [
          { name: { $regex: search, $options: 'i' } },
          { slug: { $regex: search, $options: 'i' } },
        ],
      }
      : {}; // empty object matches all

    /* ================= AGGREGATION ================= */
    const departments = await Department.aggregate([
      { $match: matchStage }, // Now this works: either {} or { $or: ... }
      { $sort: { _id: -1 } },
      { $skip: skip },
      { $limit: limit },
    ]);

    // Fix total count — countDocuments expects a filter object, not {matchStage}
    const total = await Department.countDocuments(matchStage);

    const baseUrl = "https://pub-09ddea2b87b6421a98cf13151ab300e3.r2.dev/govt-logos/";
    const extension = ".webp";
    const defaultLogo = `${baseUrl}default_logo${extension}`;

    // Parallelize logo checks using Promise.all
    await Promise.all(departments.map(async (dept) => {
      const logoUrl = `${baseUrl}${dept.slug}${extension}`;
      const imageExists = await checkImageExists(logoUrl);
      dept.logo = imageExists ? logoUrl : defaultLogo;
    }));

    const totalPages = Math.ceil(total / limit);

    res.json({
      success: true,
      currentPage: page,
      totalPages,
      totalDepartments: total,
      limit,
      count: departments.length,
      data: departments,
    });
  } catch (err) {
    console.error("Error in getDepartments:", err);
    res.status(500).json({ success: false, message: err.message });
    next(err);
  }
};

// GET /api/department/:id
export const getDepartmentById = async (req, res, next) => {
  try {
    const { slug } = req.params;
    console.log("Fetching department with ID:", slug);

    if (!slug) {
      return res.status(400).json({
        success: false,
        message: "Department slug is required",
      });
    }


    const department = await Department.findOne({ slug }); // find by slug field

    if (!department) {
      return res.status(404).json({
        success: false,
        message: "Department not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: department,
    });

  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
    next(err); // let centralized error handler catch it
  }
};

// POST: Create new department
export const createDepartment = async (req, res, next) => {
  try {
    const body = req.body || {};

    console.log("Received department data:", body);
    if (!body.name) {
      return res.status(400).json({
        success: false,
        message: "Department name is required",
      });
    }

    //  Validate using Zod
    const validatedData = createDepartmentSchema.parse(body);

    // 2️⃣ Create and save the department
    const newDepartment = new Department({
      name: validatedData.name,
      slug: validatedData.slug || null,
    });

    const savedDepartment = await newDepartment.save();

    // 3️⃣ Response
    return res.status(201).json({
      success: true,
      message: "Department created successfully",
    });
  } catch (err) {
    // 4️⃣ Handle Zod errors neatly
    if (err.name === "ZodError") {
      return res.status(400).json({
        success: false,
        message: err?.format(), // Send first error message
      });
    } else {
      return res.status(500).json({
        success: false,
        message: err,
      });
    }
  }
  next(err);
};


// update department by id

export const updateDepartment = async (req, res, next) => {
  try {
    const { id } = req.body;
    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Department ID is required",
      });
    }
    // 1️⃣ Validate body with Zod (this also auto-generates slug)
    const validatedData = createDepartmentSchema.parse(req.body);
    const { name, slug } = validatedData;

    // 2️⃣ Update the department
    const updatedDepartment = await Department.findByIdAndUpdate(
      id,
      { name, slug },
      { new: true }
    );

    if (!updatedDepartment) {
      return res.status(404).json({
        success: false,
        message: "Department not found",
      });
    }

    return res.status(201).json({
      success: true,
      message: "Department updated successfully",
    });

  } catch (err) {
    if (err.name === "ZodError") {
      return res.status(400).json({
        success: false,
        message: err?.format(),
      });
    } else {
      return res.status(500).json({
        success: false,
        message: err,
      });
    }
  }

  next(err);
};
