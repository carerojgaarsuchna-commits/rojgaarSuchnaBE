import { Admission } from "../models/Admission.js";

export const seedAdmissions = async () => {
  try {
    // Clear existing data
    await Admission.deleteMany();

    // Insert 10 sample records
    await Admission.insertMany([
      {
        title: "UPSC Civil Services Examination 2025 Online Form",
        link: "/admission/upsc-civil-services-2025"
      },
      {
        title: "NTA JEE Main January 2026 Registration",
        link: "/admission/jee-main-jan-2026"
      },
      {
        title: "CUET UG 2026 Application Form",
        link: "/admission/cuet-ug-2026"
      },
      {
        title: "SSC CHSL 2025 Application Form",
        link: "/admission/ssc-chsl-2025"
      },
      {
        title: "NEET UG 2026 Online Form",
        link: "/admission/neet-ug-2026"
      },
      {
        title: "NDA I 2026 Admission Form",
        link: "/admission/nda-i-2026"
      },
      {
        title: "Indian Air Force Agniveer Vayu 2025 Intake",
        link: "/admission/airforce-agniveer-2025"
      },
      {
        title: "DRDO Apprentice 2025 Registration",
        link: "/admission/drdo-apprentice-2025"
      },
      {
        title: "Railway RRB Technician 2025 Online Form",
        link: "/admission/rrb-technician-2025"
      },
      {
        title: "UP Police SI Recruitment 2025 Apply Online",
        link: "/admission/up-police-si-2025"
      }
    ]);

    console.log("✅ Admissions seeded successfully!");
  } catch (error) {
    console.error("❌ Error seeding admissions:", error);
  }
};
