import mongoose from "mongoose";
import { Home } from "../models/Home.js";

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
