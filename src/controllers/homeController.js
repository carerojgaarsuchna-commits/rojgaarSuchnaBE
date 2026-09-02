import mongoose from "mongoose";
import { Home } from "../models/Home.js";
import { LatestNotification } from "../models/LatestNotification.js";

const CATEGORY_MAP = {
  "latest jobs": "Job",
  "documents": "Notice",
  "admit cards": "Admit Card",
  "results": "Result",
  "admissions": "Admission",
  "answer keys": "Answer Key",
  "syllabus": "Syllabus",
  "scholarships": "Scholarship",
  "scholarship": "Scholarship",
  "tenders": "Tender",
  "tender": "Tender",
  "notices": "Notice",
  "notice": "Notice",
  "job": "Job",
};

const DEFAULT_SECTIONS = [
  { title: "Latest Jobs", category: "Job" },
  { title: "Documents", category: "Notice" },
  { title: "Admit Cards", category: "Admit Card" },
  { title: "Results", category: "Result" },
  { title: "Admissions", category: "Admission" },
  { title: "Answer Keys", category: "Answer Key" },
];

export const getHomeData = async (req, res, next) => {
  try {
    const home = await Home.findOne().lean();

    if (!home) {
      return res.status(404).json({
        success: false,
        message: "Home data not found",
      });
    }

    // Helper to populate polymorphic references cleanly
    const latestJobModelAliases = new Set([
      "LatestJob",
      "Document",
      "AdmitCard",
      "Result",
      "Admission",
      "AnswerKey",
    ]);

    async function populateRefs(items = []) {
      return Promise.all(
        items.map(async (item) => {
          const modelName = latestJobModelAliases.has(item.refModel)
            ? "LatestJob"
            : item.refModel;
          const Model = mongoose.model(modelName);

          const selectFields =
            modelName === "LatestJob"
              ? "title slug type category isAIGenerated"
              : "name logo title slug";

          const data = await Model.findById(item.refId)
            .select(selectFields) // clean output
            .lean();

          return {
            refId: item.refId,
            refModel: item.refModel,
            data,
          };
        })
      );
    }

    // Populate departments
    home.government_departments = await populateRefs(
      home.government_departments || []
    );

    // Populate footer departments
    home.footer.popular_departments = await populateRefs(
      home.footer.popular_departments || []
    );

    // Populate section jobs
    home.sections = await Promise.all(
      home.sections.map(async (section) => {
        section.jobs = await populateRefs(section.jobs || []);
        return section;
      })
    );
    // console.log('isAIGenerated', JSON.stringify(home.sections));
    return res.json({
      success: true,
      data: home,
    });
  } catch (err) {
    next(err);
  }
};

export const getAIHomeData = async (req, res, next) => {
  try {
    const home = await Home.findOne().lean();

    if (!home) {
      return res.status(404).json({
        success: false,
        message: "Home data not found",
      });
    }

    const latestJobModelAliases = new Set([
      "LatestJob",
      "Document",
      "AdmitCard",
      "Result",
      "Admission",
      "AnswerKey",
    ]);

    async function populateRefs(items = []) {
      return Promise.all(
        items.map(async (item) => {
          const modelName = latestJobModelAliases.has(item.refModel)
            ? "LatestJob"
            : item.refModel || "Department";
          const Model = mongoose.model(modelName);

          const selectFields =
            modelName === "LatestJob"
              ? "title slug type category isAIGenerated"
              : "name logo title slug";

          const data = await Model.findById(item.refId)
            .select(selectFields)
            .lean();

          return {
            refId: item.refId,
            refModel: item.refModel,
            data,
          };
        })
      );
    }

    // Populate departments
    home.government_departments = await populateRefs(
      home.government_departments || []
    );

    // Populate footer departments
    if (home.footer) {
      home.footer.popular_departments = await populateRefs(
        home.footer.popular_departments || []
      );
    }

    const sectionLimit = Math.min(
      Math.max(parseInt(req.query.limit, 10) || 6, 1),
      20
    );

    const sectionsSource =
      Array.isArray(home.sections) && home.sections.length > 0
        ? home.sections
        : DEFAULT_SECTIONS;

    home.sections = await Promise.all(
      sectionsSource.map(async (section) => {
        const titleLower = (section.title || "").trim().toLowerCase();
        const category =
          section.category || CATEGORY_MAP[titleLower] || "Job";

        // Query LatestNotification collection ONLY
        const notifications = await LatestNotification.find({
          category,
          // publish: { $ne: false },
        })
          .select("_id title slug markdown_body status publish createdAt notification_date")
          .sort({ createdAt: -1 })
          .limit(sectionLimit)
          .lean();
        const jobs = (notifications || []).map((doc) => ({
          refId: String(doc._id),
          refModel: "LatestNotification",
          data: {
            _id: String(doc._id),
            title: doc.title || "",
            slug: doc.slug || "",
            isAIGenerated: Boolean(
              doc.markdown_body && doc.markdown_body.trim() !== ""
            ),
          },
        }));

        return {
          _id: section._id ? String(section._id) : undefined,
          title: section.title,
          jobs,
        };
      })
    );


    return res.json({
      success: true,
      data: home,
    });
  } catch (err) {
    next(err);
  }
};

