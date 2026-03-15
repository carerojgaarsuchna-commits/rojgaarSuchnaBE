import mongoose from "mongoose";
import { AdmitCard } from "../models/AdmitCard.js";

export const seedAdmitCard = async () => {
    try {
        // Connect to MongoDB (only if not already connected)
        if (mongoose.connection.readyState === 0) {
            await mongoose.connect("mongodb://localhost:27017/rojgaar", {
                useNewUrlParser: true,
                useUnifiedTopology: true,
            });
            console.log("✅ MongoDB connected for seeding AdmitCard data");
        }

        // Clear existing data
        await AdmitCard.deleteMany();

        // Insert new data
        await AdmitCard.insertMany([
            {
                title: "Regarding status of application for Ministerial & Isolated posts",
                link: "https://www.rrbcdg.gov.in/uploads/2024/07-M&I/072024-ApplicationStatus.pdf",
            },
            {
                title:
                    "Revised Tentative Schedule, City-Intimation Slip and Helpdesk Link for Undergraduate Posts under Non-Technical Popular Categories",
                link: "https://www.rrbcdg.gov.in/uploads/2024/06-NTPCUG/062024-CBT1_CitySlip.pdf",
            },
            {
                title: "Regarding extension of last dates for online application processes",
                link: "https://www.rrbcdg.gov.in/uploads/2025/02-TECH/022025-Corrigendum1_Timeline.pdf",
            },
            {
                title:
                    "Reconduct of CBAT for candidates impacted by technical problems during exam held on 15-07-2025",
                link: "https://www.rrbcdg.gov.in/uploads/2024/01-ALP/012024-CBAT_Re-Exam.pdf",
            },
            {
                title:
                    "Document Verification & Medical Examination Schedule for JE/DMS - जे.ई./डी.एम.एस. के पद हेतु दस्तावेज-सत्यापन / चिकित्सा-परीक्षा की अनुसूची",
                link: "https://www.rrbcdg.gov.in/uploads/2024/03-JE/032024JE-DV1_Schedule.pdf",
            },
            {
                title:
                    "List of candidates shortlisted for Document Verification / दस्तावेज सत्यापन के लिए लघुसूचित अभ्यर्थियों की सूची",
                link: "https://www.rrbcdg.gov.in/uploads/2024/03-JE/032024JE_CBT-2_RESULT.pdf",
            },
            {
                title:
                    "CUT-OFF marks of candidates shortlisted for DV / डी.वी. के लिए चुने गए अभ्यर्थियों के कट-ऑफ अंक",
                link: "https://www.rrbcdg.gov.in/uploads/2024/03-JE/032024JE_CBT-2_CUT-OFF.pdf",
            },
            {
                title:
                    "Update regarding declaration of CBT-2 Result conducted on 04-06-2025 / 04-06-2025 को आयोजित CBT-2 परीक्षा के परिणाम की घोषणा संबंधी अपडेट",
                link: "https://www.rrbcdg.gov.in/uploads/2024/03-JE/CBT2_CommonResultNotice21-7-2025.pdf",
            },
            {
                title:
                    "Regarding conduct of CBAT held on 15-07-2025 / 15-07-2025 को आयोजित कंप्यूटर-आधारित योग्यता परीक्षा के संबंध में जरूरी सूचना",
                link: "https://www.rrbcdg.gov.in/uploads/2024/01-ALP/012024-CBAT%2015.07.2025.pdf",
            },
            {
                title:
                    "Document Verification (Round-2) schedule for the post of Technician-I & III / तकनीशियन-I व III के पद हेतु दस्तावेज सत्यापन (राउन्ड-2) (29-07-2025)",
                link: "https://www.rrbcdg.gov.in/uploads/2024/02-TECH/022024-DV_(Round2).pdf",
            },
        ]);

        console.log("✅ AdmitCard data seeded successfully!");
        mongoose.connection.close();
    } catch (error) {
        console.error("❌ Error seeding AdmitCard data:", error);
        mongoose.connection.close();
    }
};

// If you want this to auto-run when executed:
if (import.meta.url === `file://${process.argv[1]}`) {
    seedAdmitCard();
}
