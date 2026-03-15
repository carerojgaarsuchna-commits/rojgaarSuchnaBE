import mongoose from "mongoose";
import { Department } from "./Department.js";
import { LatestJob } from "./LatestJob.js";
import { Document } from "./Document.js";
import { AdmitCard } from "./AdmitCard.js";
import { Result } from "./Result.js";
import { Admission } from "./Admission.js";
import { AnswerKey } from "./AnswerKey.js";
const faqSchema = new mongoose.Schema({
  question: String,
  answer: String
});

const homeSchema = new mongoose.Schema({
  what_is_rojgaar_suchna: String,
  home_page_slider: [{ title: String, subtitle: String, image: String, link: String }],
  government_departments: [
    {
      refId: { type: mongoose.Schema.Types.ObjectId, required: true },
      refModel: { type: String, default: "Department" }
    }
  ],
  sections: [
    {
      title: String,
      jobs: [
        {
          refId: {
            type: mongoose.Schema.Types.ObjectId,
            required: true
          },
          refModel: {
            type: String,
            enum: [
              "LatestJob",
              "Document",
              "AdmitCard",
              "Result",
              "Admission",
              "AnswerKey"
            ],
            required: true,
            default: "LatestJob"
          }
        }
      ]
    }
  ],

  faq: [faqSchema],
  footer: {
    brand: String,
    useful_links: [{ label: String, link: String }],
    popular_departments: [
      {
        refId: { type: mongoose.Schema.Types.ObjectId, required: true },
        refModel: { type: String, default: "Department" }
      }
    ],
    contact: {
      email: String,
      phone: String,
      address: String
    },
    social_links: [{ label: String, link: String, icon: String }]
  }
});

export const Home = mongoose.model("Home", homeSchema);
