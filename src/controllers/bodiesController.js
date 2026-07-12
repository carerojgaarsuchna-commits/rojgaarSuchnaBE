import { Bodies } from "../models/Bodies.js";
import { Department } from "../models/Department.js";
import axios from "axios";
import { createDepartmentSchema } from "../validators/departmentValidator.js";
import { checkImageExists } from "../utils/helper.js";
// R2 Base URL settings
const baseUrl = "https://pub-09ddea2b87b6421a98cf13151ab300e3.r2.dev/govt-logos/";
const extension = ".webp";


// ===============================================
// GET ALL BODIES — Paginated + slug Validation
// ===============================================
export const getBodies = async (req, res, next) => {
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
    const total = await Bodies.countDocuments(matchStage);

    let bodies = await Bodies.find(matchStage)
      .skip(skip)
      .limit(limit)
      .sort({ _id: -1 })
      .populate("department");

    // Attach validated image URLs (same as departments logic)
    const formattedBodies = await Promise.all(
      bodies.map(async (b) => {
        const fullLogoUrl = `${baseUrl}${b.slug}${extension}`;
        const exists = await checkImageExists(fullLogoUrl);

        return {
          ...b.toObject(),
          logo: exists ? fullLogoUrl : `${baseUrl}default_logo${extension}`,
        };
      })
    );

    return res.json({
      success: true,
      currentPage: page,
      totalPages: Math.ceil(total / limit),
      totalBodies: total,
      limit,
      count: formattedBodies.length,
      data: formattedBodies,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
    next(err);
  }
};

// Get body by department slug
export const getBodiesByDepartment = async (req, res, next) => {
  try {
    const slug = req.params.slug;
    if (!slug) {
      return res.status(400).json({
        success: false,
        message: "Department slug is required",
      });
    }
    // Build the match condition correctly
    const departmentId = await Department.findOne({ slug: slug }).select("_id");
    if (!departmentId) {
      return res.status(404).json({
        success: false,
        message: "Department not found",
      });
    }
  
    let bodies = await Bodies.find({department: departmentId._id})
      .populate("department");

    // Attach validated image URLs (same as departments logic)
    const formattedBodies = await Promise.all(
      bodies.map(async (b) => {
        const fullLogoUrl = `${baseUrl}${b.slug}${extension}`;
        const exists = await checkImageExists(fullLogoUrl);

        return {
          ...b.toObject(),
          logo: exists ? fullLogoUrl : `${baseUrl}default_logo${extension}`,
        };
      })
    );

    return res.json({
      success: true,
      count: formattedBodies.length,
      data: formattedBodies,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
    next(err);
  }
};


// ===============================================
// GET BODY BY ID
// ===============================================
export const getBodyById = async (req, res, next) => {
  try {
    const { slug } = req.params;
    if (!slug) {
      return res.status(400).json({
        success: false,
        message: "Body slug is required",
      });
    }

    const body = await Bodies.findOne({ slug: slug }).populate("department");

    if (!body) {
      return res.status(404).json({
        success: false,
        message: "Bodies not found",
      });
    }

    // Build slug URL + validate exists
    const fullLogoUrl = `${baseUrl}${body.slug}${extension}`;
    const exists = await checkImageExists(fullLogoUrl);

    return res.json({
      success: true,
      data: {
        ...body.toObject(),
        slug: exists ? fullLogoUrl : `${baseUrl}default_logo${extension}`,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
    next(err);
  }
};


// ===============================================
// CREATE BODY  (can add Zod later same as department)
// ===============================================
export const createBody = async (req, res, next) => {
  try {
    const body = req.body || {};

    // console.log("Received body data:", body);
    if (!body.name) {
      return res.status(400).json({
        success: false,
        message: "Body name is required",
      });
    }
    if (!body.departmentId) {
      return res.status(400).json({
        success: false,
        message: "Department ID is required",
      });
    }

    const validatedData = createDepartmentSchema.parse(body);

    const newBody = new Bodies({
      name: validatedData.name,
      slug: validatedData.slug || null,
      department: body.departmentId,
    });

    const savedBody = await newBody.save();

    return res.status(201).json({
      success: true,
      message: "Body created successfully",
    });
  } catch (err) {
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


// ===============================================
// UPDATE BODY BY ID
// ===============================================
export const updateBody = async (req, res, next) => {
  try {
    const { slug, departmentId, name } = req.body || {};
   
    if (!departmentId) {
      return res.status(400).json({
        success: false,
        message: "Department ID is required",
      });
    }

    if (!name) {
      return res.status(400).json({
        success: false,
        message: "Body name is required",
      });
    }

    const validatedData = createDepartmentSchema.parse(req.body);

    const updated = await Bodies.findOneAndUpdate(
      { slug: slug },
      {
        name: validatedData.name,
        slug: validatedData.slug,
        department: departmentId,
      },
      { new: true }
    );


    if (!updated) {
      return res.status(404).json({
        success: false,
        message: "Body not found",
      });
    }

    return res.json({
      success: true,
      message: "Body updated successfully",
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.format() });
    next(err);
  }
};
