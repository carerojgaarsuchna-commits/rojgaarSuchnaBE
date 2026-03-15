// server/controllers/latestJobController.js
import { LatestJob } from "../models/LatestJob.js";
import { seedHome } from "../seeders/homeSeeder.js";
import { upload } from "../utils/multerConfig.js";

const triggerHomeSeed = () => {
  seedHome().catch((error) => {
    console.error("Failed to run seedHome after latest job change:", error);
  });
};

// GET: Paginated + Filtered + Search
export const getLatestJobs = async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 10,
      type,
      category,
      body,
      department,
      search,
      status = "active",
    } = req.query;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // Build filter
    let filter = { status };
    if (type) filter.type = type;
    if (category) filter.category = category;
    if (department) filter.department = department;
    if (body) filter.body = body;
    if (search) {
      filter = {
        $or: [
          { title: { $regex: search, $options: 'i' } },
          { slug: { $regex: search, $options: 'i' } },
        ],
      }
    }

    // Count total
    const total = await LatestJob.countDocuments(filter);

    // Fetch with population
    const jobs = await LatestJob.find(filter)
      .populate("department", "name logo")
      .populate("body", "name logo")
      .sort({ publishedAt: -1 })
      .skip(skip)
      .limit(limitNum);

    res.json({
      success: true,
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(total / limitNum),
        totalJobs: total,
        hasNext: pageNum < Math.ceil(total / limitNum),
        hasPrev: pageNum > 1,
      },
      data: jobs,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
    next(err);
  }
};

// GET: Single Job by Slug
export const getLatestJobBySlug = async (req, res, next) => {
  try {
    const { slug } = req.params;
    const job = await LatestJob.findOne({ slug })
      .populate("department", "name logo")
      .populate("body", "name");

    if (!job) {
      return res.status(404).json({ success: false, message: "Job not found" });
    }

    job.views += 1;
    await job.save();

    res.json({ success: true, data: job });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
    next(err);
  }
};

// POST: Create Latest Job
export const createLatestJob = async (req, res, next) => {
  try {
    const data = req.validatedData;

    let slug = data?.slug;
    if (!slug && data?.title) {
      slug = data.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "")
        .slice(0, 100);
      data.slug = slug;
    }

    if (slug) {
      const existing = await LatestJob.findOne({ slug });
      if (existing) {
        const updated = await LatestJob.findByIdAndUpdate(existing._id, data, { new: true });
        const populated = await LatestJob.findById(updated._id)
          .populate("department", "name logo")
          .populate("body", "name");
        triggerHomeSeed();

        return res.status(200).json({
          success: true,
          data: populated,
          message: "Job updated (slug already existed)",
        });
      }
    }

    const job = new LatestJob(data);
    await job.save();

    const populated = await LatestJob.findById(job._id)
      .populate("department", "name logo")
      .populate("body", "name");
    triggerHomeSeed();
    res.status(201).json({
      success: true,
      data: populated,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
    next(err);
  }
};


// PUT: Update Job
export const updateLatestJob = async (req, res, next) => {
  try {
    const { id } = req.body;
    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Job ID is required for update",
      });
    }
    if (!req.validatedData) {
      return res.status(400).json({
        success: false,
        message: "No data to update",
      });
    }
    const data = req.validatedData;

    const job = await LatestJob.findByIdAndUpdate(id, data, { new: true });
    if (!job) {
      return res.status(404).json({ success: false, message: "Job not found" });
    }


    const populated = await LatestJob.findById(job._id)
      .populate("department", "name logo")
      .populate("body", "name");

    res.status(201).json({
      success: true,
      data: populated,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
    next(err);
  }
};

// DELETE: Remove Job
export const deleteLatestJob = async (req, res, next) => {
  try {
    const { slug } = req.params;

    const job = await LatestJob.findByIdAndDelete({ slug: slug });
    if (!job) {
      return res.status(404).json({ success: false, message: "Job not found" });
    }

    res.json({ success: true, message: "Job deleted successfully" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
    next(err);
  }
};
