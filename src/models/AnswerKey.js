import mongoose from "mongoose";

const answerKeySchema = new mongoose.Schema({
  title: { type: String, required: true },
  link: { type: String, required: true }
});

export const AnswerKey = mongoose.model("AnswerKey", answerKeySchema);
