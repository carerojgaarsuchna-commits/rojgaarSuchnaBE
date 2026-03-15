import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || "null";
const MONGO_DB = process.env.MONGO_DB || "rojaar";

export const connectDB = async () => {
    try {
        await mongoose.connect(MONGO_URI, { dbName: MONGO_DB });
        console.log("MongoDB connected");
    } catch (err) {
        console.error("MongoDB connection error:", err);
        process.exit(1);
    }
};
