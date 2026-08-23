import { callTextLlm, getTextModel } from "./ai-api/aiProvider.js";

const AIPROMPT = `

You are an expert SEO content writer for "Rojgaar Suchna", India's top portal for sarkari naukri alerts, admit cards, and exam results.

Rewrite the provided [ARTICLE_TEXT] in 100% original words. Never copy phrases or structure.

Core Rules:
- Simple English mix for Tier-2/3 city readers (pan india)
- Short sentences (under 20 words). Max 3 lines per paragraph.
- Active voice. Friendly, urgent tone: "Apply now before deadline!"
- Fix errors, add verified facts (dates, links from official sites)

SEO Must-Haves:
- Primary keyword
- LSI
- Mobile-first
- Internal links

Exact Output Structure (copy this format):

# SEO Title (55 chars max, keyword front-loaded)
Meta Description (155 chars max, keyword + CTA)

### Short Introduction (100 words max)

### 📅 Important Dates
| Event | Date |
|-------|------|
| ... | ... |

### 💼 Vacancy Details
- List posts, expected vacancies
- Education table

### 👤 Eligibility Criteria
Numbered requirements + quick checklist

### 📊 Age Limit Table
| Post | Age | Birth Range |

### 💰 Application Fee
Details + payment methods

### 🧭 Selection Process
3 stages with bullets

### 💵 Salary & Benefits
Year-wise breakdown

### 📝 How to Apply (7 Steps)
1. Visit joinindianarmy.nic.in
...

### 📂 Required Documents
Bullet list with file specs

### ✅ Why Apply Now?
5 bullet benefits

### 🧠 Preparation Tips
6 numbered tips

### ❓ FAQs (6 Questions)
Q1: [Question]  
A: [Answer]

### 🎯 Final Call-to-Action
Urgent CTA + official links

Input Article: [PASTE_FULL_ARTICLE_HERE]

`

/**
 * Generate a full SEO blog article in Markdown using the configured AI provider.
 * Routes through aiProvider.js so AI_PROVIDER env variable is respected.
 * Returns the raw markdown string.
 */
export async function createAIBlog(blogTxt) {
    try {
        if (!blogTxt?.trim()) {
            console.error("[createAIBlog] No blog text provided — skipping.");
            return "";
        }

        const prompt = AIPROMPT + " " + blogTxt;
        const model = getTextModel();
        const result = await callTextLlm(prompt, model);

        // callTextLlm returns { raw, latencyMs }
        return result?.raw || "";
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`AI blog generation failed: ${message}`);
    }
}
