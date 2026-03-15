import { z } from "zod";
const dateYYYYMMDD = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD")
  .refine(
    (v) => !isNaN(Date.parse(v)),
    "Invalid date"
  );
export const jobNotificationsSchema = z.object({
  title: z
    .string()
    .min(5, "Title must be at least 5 characters")
    .max(200),

  department: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/, "Invalid Department ID"),

  body: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/, "Invalid Body ID"),

  type: z.enum([
    "latest-jobs",
    "results",
    "admit-cards",
    "answer-keys",
    "syllabus",
    "documents",
    "scheme",
    "scholarship",
    "notice",
    "admissions"
  ]),

  // totalPosts is required → convert string → number
  totalPosts: z.preprocess(
    (val) => {
      // Optional field → allow empty
      if (val === undefined || val === null || val === "") {
        return undefined;
      }

      const num = Number(val);
      return Number.isNaN(num) ? undefined : num;
    },
    z
      .number()
      .int("Total posts must be an integer")
      .positive("Total posts must be a positive number")
      .optional()
  ),

  postName: z
    .string()
    .optional()
    .transform(val => (val?.trim() ? val : undefined)),

  applyLink: z
    .string()
    .url("Invalid applyLink URL"),

  officialWebsite: z
    .string()
    .url("Invalid officialWebsite URL"),

  // lastDate: dateYYYYMMDD,

  content: z
    .string()
    .min(50, "Content too short"),

  // Tags required → form-data comes as: "tag1,tag2"
  tags: z.preprocess(
    (val) => {
      if (Array.isArray(val)) return val;
      return String(val)
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
    },
    z.array(z.string()).min(1, "At least one tag is required")
  ),
  importantDates: z
    .preprocess((val) => {
      // If field is missing or empty string → treat as undefined
      if (val === undefined || val === null || val === "") {
        return undefined;
      }

      // If coming as JSON string → parse it
      if (typeof val === "string") {
        try {
          return JSON.parse(val);
        } catch {
          return undefined;
        }
      }

      return val;
    },
      z.array(
        z.object({
          label: z.string(),
          date: z.string(),
        })
      ).optional()
    ),

  // ageLimit required → JSON required
  ageLimit: z.preprocess(
    (val) => {
      // If field is missing or empty → treat as undefined
      if (val === undefined || val === null || val === "") {
        return undefined;
      }

      // If coming as JSON string (FormData case)
      if (typeof val === "string") {
        try {
          return JSON.parse(val);
        } catch {
          return undefined;
        }
      }

      return val;
    },
    z
      .object({
        min: z.number(),
        max: z.number(),
        asOn: z.string(),
        relaxation: z.string(),
      })
      .optional()
  ),
  //status only one at a time
  status: z.enum(["active", "draft", "expired"]),
  isFeatured: z.boolean().optional(),
  views: z.string().optional(),
  seo: z.string().optional(),
  shares: z.string().optional(),
  notificationPdf: z.string().min(1, "PDF path required"),
});

