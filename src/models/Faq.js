import mongoose from "mongoose";
const faqSchema = new mongoose.Schema({
  question: { type: String, required: true },
  answer: { type: String, required: true }
});
export const Faq = mongoose.model("Faq", faqSchema);
