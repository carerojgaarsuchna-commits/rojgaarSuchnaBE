import mongoose from "mongoose";
import { Department } from "./Department.js"; // important!

const bodiesSchema = new mongoose.Schema({
  name: { type: String, required: true },
  slug: {
    type: String,
    required: true,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    index: true,
  },

  // Relation (Foreign key)
  department: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Department",
  },

  slug: { type: String, required: true }
});

export const Bodies = mongoose.model("Bodies", bodiesSchema);
