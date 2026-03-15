import mongoose from "mongoose";
const documentSchema = new mongoose.Schema({
  title: String,
  link: String
});
export const Document = mongoose.model("Document", documentSchema);
