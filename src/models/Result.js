import mongoose from "mongoose";
const resultSchema = new mongoose.Schema({
  title: String,
  link: String
});
export const Result = mongoose.model("Result", resultSchema);
