import mongoose from "mongoose";
import { AnswerKey } from "../models/AnswerKey.js";
import { connectDB } from "../config/db.js";

export const seedAnswerKeys = async () => {
  try {
    if (mongoose.connection.readyState === 0) {
      await connectDB();
      console.log("✅ MongoDB connected for seeding AnswerKeys");
    }

    await AnswerKey.deleteMany();
    await AnswerKey.insertMany([
      {
        title:
          "Viewing of questions, responses & answer keys of CBT-1 and raising of objections (if any)",
        link: "https://www.rrbcdg.gov.in/uploads/2024/05-NTPCG/052024-CBT1_ObjectionTracker.pdf",
      },
      {
        title:
          "Viewing of questions, responses & answer keys of CBT-1 and raising of objections (if any)",
        link: "https://www.rrbcdg.gov.in/uploads/2024/06-NTPCUG/062024-CBT1-ObjectionTracker.pdf",
      },
    ]);

    console.log("✅ Answer Keys seeded successfully!");
  } catch (error) {
    console.error("❌ Error seeding Answer Keys:", error);
    mongoose.connection.close();
  }
};

