export const ALLOWED_NOTIFICATION_CATEGORIES = [
    "Job",
    "Result",
    "Admit Card",
    "Answer Key",
    "Syllabus",
    "Admission",
    "Notice",
    "Scholarship",
    "Tender",
];

const ALLOWED_CATEGORY_SET = new Set(ALLOWED_NOTIFICATION_CATEGORIES);

const LEGACY_CATEGORY_MAP = new Map([
    ["job vacancy", "Job"],
    ["other", "Notice"],
]);

const CATEGORY_RULES = [
    { category: "Scholarship", patterns: ["scholarship", "stipend", "fellowship"] },
    { category: "Answer Key", patterns: ["answer key", "provisional key", "final key", "objection notice"] },
    { category: "Admit Card", patterns: ["admit card", "call letter", "hall ticket", "e-admit card"] },
    { category: "Syllabus", patterns: ["syllabus"] },
    { category: "Admission", patterns: ["admission", "counselling", "counseling", "seat allotment"] },
    { category: "Tender", patterns: ["tender", "bid document", "e-tender", "e procurement", "procurement"] },
    {
        category: "Result",
        patterns: [
            "result",
            "merit list",
            "shortlist",
            "short list",
            "cut off",
            "cutoff",
            "selected candidate",
            "selected candidates",
            "select list",
            "supplementary result",
            "application status",
        ],
    },
    {
        category: "Job",
        patterns: [
            "recruitment advertisement",
            "recruitment",
            "vacancy",
            "advertisement",
            "advertisement no",
            "advt",
            "post of",
        ],
    },
    {
        category: "Notice",
        patterns: [
            "corrigendum",
            "notice",
            "one time registration",
            "o.t.r",
            "otr",
            "exam calendar",
            "schedule",
            "city intimation",
            "document verification",
            "medical examination",
            "pet",
            "cbt",
            "interview",
        ],
    },
];

function normalizeValue(value) {
    return typeof value === "string" ? value.trim() : "";
}

function toLookupValue(value) {
    return normalizeValue(value).toLowerCase();
}

function findDerivedCategory(text) {
    for (const rule of CATEGORY_RULES) {
        if (rule.patterns.some((pattern) => text.includes(pattern))) {
            return rule.category;
        }
    }

    return "Notice";
}

export function deriveNotificationCategory(notificationType = "", title = "") {
    const lookupText = `${normalizeValue(notificationType)} ${normalizeValue(title)}`.toLowerCase();
    return findDerivedCategory(lookupText);
}

export function normalizeNotificationCategory(category = "", notificationType = "", title = "") {
    const normalizedCategory = normalizeValue(category);

    if (ALLOWED_CATEGORY_SET.has(normalizedCategory)) {
        return normalizedCategory;
    }

    const mappedLegacyCategory = LEGACY_CATEGORY_MAP.get(toLookupValue(normalizedCategory));
    if (mappedLegacyCategory) {
        return mappedLegacyCategory;
    }

    return deriveNotificationCategory(notificationType, title);
}
