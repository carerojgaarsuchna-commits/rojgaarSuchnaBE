import { z } from "zod";
import { departmentSlugify } from "../utils/helper.js";
export const createDepartmentSchema = z.object({
  name: z.string()
    .min(3, "Department name must be at least 3 characters")
    .max(150, "Department name too long")
    .trim(),
})
// Automatically add the logo field based on name
.transform((data) => ({
  name: data.name,
  slug: departmentSlugify(data.name),
}));