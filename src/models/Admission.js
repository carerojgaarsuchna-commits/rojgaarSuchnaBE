import mongoose from "mongoose";
const admissionSchema = new mongoose.Schema({
  title: String,
  link: String
});
export const Admission = mongoose.model("Admission", admissionSchema);
