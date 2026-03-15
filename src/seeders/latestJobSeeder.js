import mongoose from "mongoose";
import { LatestJob } from "../models/LatestJob.js";
import { connectDB } from "../config/db.js";

export const seedLatestJobs = async () => {
  try {
    // Connect to MongoDB
    if (mongoose.connection.readyState === 0) {
      await connectDB();
      console.log("✅ MongoDB connected for seeding Latest Jobs");
    }

    // Clear existing data
    await LatestJob.deleteMany();
    console.log("🗑️ Cleared old LatestJob data");

    // Sample Department and Body IDs (replace with your real IDs from DB)
    const railwayDeptId = "60c72b2f9b1d8e001c8e4a10"; // Ministry of Railways
    const rrbChandigarhId = "60c72b2f9b1d8e001c8e4a11"; // RRB Chandigarh

    // Insert new RRB-based job notifications
    await LatestJob.insertMany([
      {
        title: "Regarding status of application for Ministerial & Isolated posts",
        slug: "rrb-ministerial-isolated-application-status-2024",
        organization: "Railway Recruitment Board",
        department: railwayDeptId,
        body: rrbChandigarhId,
        type: "notice",
        category: "Railway",
        notificationPdf: "https://www.rrbcdg.gov.in/uploads/2024/07-M&I/072024-ApplicationStatus.pdf",
        content: `
          <p>The <strong>Railway Recruitment Board (RRB)</strong> has released the application status for <strong>Ministerial & Isolated posts</strong> under CEN 07/2024.</p>
          <h3>Application Status</h3>
          <table class="ql-table">
            <tr><th>Category</th><th>Status</th></tr>
            <tr><td>Steno</td><td>Released</td></tr>
            <tr><td>Teacher</td><td>Pending</td></tr>
          </table>
          <p>Check status on the official website.</p>
        `,
        importantDates: [
          { label: "Status Released", date: "15 July 2024", timestamp: new Date("2024-07-15") },
        ],
        tags: ["RRB", "Ministerial", "Application Status"],
        publishedAt: new Date("2024-07-15T10:00:00Z"),
        status: "active",
      },
      {
        title: "Extension of last dates for Technician posts (CEN 02/2025)",
        slug: "rrb-technician-extension-cen-02-2025",
        organization: "Railway Recruitment Board",
        department: railwayDeptId,
        body: rrbChandigarhId,
        type: "job",
        category: "Railway",
        totalPosts: 14298,
        postName: "Technician Gr-III",
        applyLink: "https://www.rrbcdg.gov.in/apply",
        notificationPdf: "https://www.rrbcdg.gov.in/uploads/2025/02-TECH/022025-Corrigendum1_Timeline.pdf",
        content: `
          <p>RRB has extended the application deadline for <strong>Technician posts</strong> under <strong>CEN 02/2025</strong>.</p>
          <h3>Revised Timeline</h3>
          <table class="ql-table">
            <tr><th>Event</th><th>Old Date</th><th>New Date</th></tr>
            <tr><td>Apply Start</td><td>01 Jan 2025</td><td>01 Jan 2025</td></tr>
            <tr><td>Apply End</td><td>28 Feb 2025</td><td>15 Mar 2025</td></tr>
          </table>
        `,
        importantDates: [
          { label: "Apply Start", date: "01 January 2025", timestamp: new Date("2025-01-01") },
          { label: "Apply End", date: "15 March 2025", timestamp: new Date("2025-03-15") },
        ],
        ageLimit: { min: 18, max: 33, asOn: "01/01/2025", relaxation: "As per RRB rules" },
        tags: ["RRB", "Technician", "CEN 02/2025"],
        publishedAt: new Date("2025-02-01T08:00:00Z"),
        status: "active",
      },
      {
        title: "Application Status for NTPC Undergraduate posts (CEN 06/2024)",
        slug: "rrb-ntpc-undergraduate-status-2024",
        organization: "Railway Recruitment Board",
        department: railwayDeptId,
        body: rrbChandigarhId,
        type: "notice",
        category: "Railway",
        notificationPdf: "https://www.rrbcdg.gov.in/uploads/2024/06-NTPCUG/062024-ApplicationStatus.pdf",
        content: `
          <p>RRB has published the <strong>application status</strong> for <strong>NTPC Undergraduate posts</strong> under CEN 06/2024.</p>
          <h3>Status by Region</h3>
          <table class="ql-table">
            <tr><th>Region</th><th>Status</th></tr>
            <tr><td>RRB Chandigarh</td><td>Live</td></tr>
            <tr><td>RRB Mumbai</td><td>Pending</td></tr>
          </table>
        `,
        importantDates: [
          { label: "Status Released", date: "10 June 2024", timestamp: new Date("2024-06-10") },
        ],
        tags: ["RRB", "NTPC", "Undergraduate"],
        publishedAt: new Date("2024-06-10T09:00:00Z"),
        status: "active",
      },
    ]);

    console.log("✅ Latest Job data seeded successfully!");
  } catch (error) {
    console.error("❌ Error seeding Latest Job data:", error);
  } finally {
    // Optional: Keep connection open for dev
    // mongoose.connection.close();
  }
};