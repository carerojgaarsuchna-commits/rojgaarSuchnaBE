import { Document } from "../models/Document.js";

export const seedDocuments = async () => {
  await Document.deleteMany();
  await Document.insertMany([
    {
      title: "SSC CGL Notification 2025",
      link: "/documents/ssc-cgl-notification-2025.pdf"
    },
    {
      title: "UPSC Annual Calendar 2025",
      link: "/documents/upsc-annual-calendar-2025.pdf"
    },
    {
      title: "Railway Recruitment Board (RRB) Vacancy Brochure 2025",
      link: "/documents/rrb-vacancy-brochure-2025.pdf"
    },
    {
      title: "IBPS Exam Schedule 2024-25",
      link: "/documents/ibps-exam-schedule-2024-25.pdf"
    },
    {
      title: "NTA Exam Calendar 2025",
      link: "/documents/nta-exam-calendar-2025.pdf"
    },
    {
      title: "DRDO Recruitment Guidelines 2025",
      link: "/documents/drdo-recruitment-guidelines-2025.pdf"
    },
    {
      title: "ISRO Recruitment Notification 2025",
      link: "/documents/isro-recruitment-notification-2025.pdf"
    },
    {
      title: "Central Government Reservation Policy PDF",
      link: "/documents/central-govt-reservation-policy.pdf"
    },
    {
      title: "OBC Caste Certificate Format (Central)",
      link: "/documents/obc-certificate-format-central.pdf"
    },
    {
      title: "Income & Asset Certificate Format (EWS)",
      link: "/documents/ews-certificate-format.pdf"
    },
    {
      title: "Character Certificate Format",
      link: "/documents/character-certificate-format.pdf"
    },
    {
      title: "Medical Fitness Certificate Form",
      link: "/documents/medical-fitness-form.pdf"
    }
  ]);

  console.log("✅ Documents seeded successfully!");
};
