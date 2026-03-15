import mongoose from "mongoose";
const admitCardSchema = new mongoose.Schema({
  title: String,
  link: String
});
export const AdmitCard = mongoose.model("AdmitCard", admitCardSchema);
