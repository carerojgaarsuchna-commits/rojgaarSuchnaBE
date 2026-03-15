import mongoose from "mongoose";
import dotenv from "dotenv";
import { connectDB } from "../config/db.js";
import { seedHome } from "./homeSeeder.js";
import { seedDepartments } from "./departmentSeeder.js";
import { seedAnswerKeys } from "./answerKeySeeder.js";
import { seedDocuments } from "./documentSeeder.js";
import { seedAdmissions } from "./admissionSeeder.js";
import { seedFaqs } from "./faqSeeder.js";
import { seedResults } from "./resultSeeder.js";
import { seedLatestJobs } from "./latestJobSeeder.js";
import { seedBodies } from "./bodiesSeeder.js";

dotenv.config();

const runSeeders = async () => {
  await connectDB();
  try {
    console.log("✅ MongoDB connected");

 
    // await seedDepartments();
    // await seedBodies();
    // await seedAnswerKeys();
    // await seedDocuments();
    // await seedAdmissions();
    // await seedResults();
    // await seedLatestJobs();
    // await seedFaqs();
    await seedHome();
    console.log("🌱 All seeders executed successfully!");
  } catch (error) {
    console.error("❌ Seeding failed:", error);
  } finally {
    await mongoose.connection.close();
    console.log("🔌 MongoDB connection closed");
  }
};

runSeeders();
