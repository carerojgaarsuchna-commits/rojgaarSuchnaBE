/**
 * matching.service.js
 * Stage 1 — Deterministic notification matching.
 *
 * Flow:
 *   1. extractCandidates(html)  → array of { title, href, dom_context }
 *   2. scoreCandidates(candidates, context) → ranked list with scores
 *   3. decide(ranked) → { status, matched, needsLlm }
 */

import * as cheerio from "cheerio";
import {
  normalizeTitle,
  tokenSimilarity,
  containsAny,
  extractAdNo,
  adNoMatch,
  cleanDiffText,
  splitDiffSegments,
  isTickerOrNoiseDiff,
} from "../../utils/textNormalize.js";

// Recruitment-related keywords used to boost relevance
const RECRUITMENT_KEYWORDS = [
  "recruitment",
  "vacancy",
  "advertisement",
  "advt",
  "notification",
  "apply",
  "application",
  "post",
  "result",
  "admit card",
  "answer key",
  "syllabus",
  "admit",
  "selection",
  "merit list",
  "interview",
  "written exam",
  "document verification",
  "tender",
  "scholarship",
  "admission",
  "counselling",
  "cbt",
  "score card",
  "cut off",
  "e-call letter",
];

// URL path signals that suggest a PDF link
const PDF_URL_SIGNALS = [".pdf", "/pdf/", "download", "notice", "advt"];

/**
 * Extract anchor candidate links from the page HTML.
 * Returns an array of { title, href, dom_context }.
 *
 * @param {string} html
 * @returns {Array<{title:string, href:string, dom_context:string}>}
 */
export function extractCandidates(html) {
  const $ = cheerio.load(html);
  const candidates = [];
  const seenHrefs = new Set();

  $("a[href]").each((_, el) => {
    const $el = $(el);
    const href = ($el.attr("href") || "").trim();
    let title = $el.text().trim().replace(/\s+/g, " ");

    if (!title) {
      title = ($el.attr("title") || $el.attr("aria-label") || "").trim().replace(/\s+/g, " ");
    }

    // Skip empty, javascript, and anchor-only links
    if (!title || !href || href.startsWith("#") || href.startsWith("javascript")) {
      return;
    }

    // Grab nearby text context (parent row / list item / div text)
    const $parent = $el.closest("tr, li, div, p, td");
    const dom_context = $parent.text().trim().replace(/\s+/g, " ").slice(0, 300);

    const dedupKey = `${href}|${title}`;
    if (!seenHrefs.has(dedupKey)) {
      seenHrefs.add(dedupKey);
      candidates.push({ title, href, dom_context });
    }
  });

  return candidates;
}

/**
 * Score a single candidate against the webhook context.
 *
 * Scoring breakdown (max 100):
 *  - Title similarity to diff_added segments  0–50
 *  - Recruitment keyword in title/context      0–20
 *  - Ad number match                           0–15
 *  - URL signals (pdf, download)               0–10
 *  - watch_url domain match                    0–5
 *
 * @param {{ title:string, href:string, dom_context:string }} candidate
 * @param {{ diff_added:string, watch_url:string, watch_title:string }} context
 * @returns {number} 0–100
 */
export function scoreCandidate(candidate, context) {
  const { title, href, dom_context } = candidate;
  const { diff_added = "", watch_url = "", watch_title = "" } = context;

  let score = 0;

  const cleanedDiff = cleanDiffText(diff_added);
  const segments = splitDiffSegments(diff_added);

  // 1. Title similarity matching (0–50)
  let bestSim = 0;
  if (segments.length > 0) {
    bestSim = Math.max(...segments.map((seg) => tokenSimilarity(title, seg)));
  } else if (cleanedDiff) {
    bestSim = tokenSimilarity(title, cleanedDiff);
  }

  // Exact or near-exact substring match bonus
  const normTitle = normalizeTitle(title);
  const normCleanDiff = normalizeTitle(cleanedDiff);
  if (normTitle.length > 8 && normCleanDiff.includes(normTitle)) {
    bestSim = Math.max(bestSim, 95);
  }

  score += Math.round(bestSim * 0.5);

  // 2. Recruitment keyword in title or dom_context (0–20)
  const combinedText = `${title} ${dom_context}`;
  if (containsAny(combinedText, RECRUITMENT_KEYWORDS)) {
    score += 20;
  }

  // 3. Ad number match between diff_added and title/context (0–15)
  const diffAdNo = extractAdNo(cleanedDiff);
  const candidateAdNo = extractAdNo(combinedText);
  if (adNoMatch(diffAdNo, candidateAdNo)) {
    score += 15;
  }

  // 4. URL signals for PDF/download (0–10)
  const hrefLower = (href || "").toLowerCase();
  if (containsAny(hrefLower, PDF_URL_SIGNALS)) {
    score += 10;
  }

  // 5. Same domain as watch_url (0–5)
  try {
    const watchDomain = new URL(watch_url).hostname;
    const hrefFull = href.startsWith("http") ? href : `${watch_url}/${href}`;
    const candidateDomain = new URL(hrefFull).hostname;
    if (watchDomain && candidateDomain === watchDomain) {
      score += 5;
    }
  } catch {
    // URL parse failed — skip domain check
  }

  return Math.min(score, 100);
}

/**
 * Score all candidates and return them sorted highest-first.
 *
 * @param {Array} candidates
 * @param {{ diff_added:string, watch_url:string, watch_title:string }} context
 * @returns {Array<{title,href,dom_context,score}>}
 */
export function rankCandidates(candidates, context) {
  return candidates
    .map((c) => ({ ...c, score: scoreCandidate(c, context) }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Decision rules from the plan:
 *  score ≥ 85                      → HIGH_CONFIDENCE (matched, enqueue pdf)
 *  score 60–84, gap to 2nd ≥ 15   → HIGH_CONFIDENCE (matched, enqueue pdf)
 *  score 60–84, gap to 2nd < 15   → AMBIGUOUS (needs LLM disambiguation)
 *  score < 60                      → NO_MATCH (match_failed)
 *
 * @param {Array<{title,href,dom_context,score}>} ranked
 * @returns {{ decision: 'high'|'ambiguous'|'no_match', top: object|null, all: Array }}
 */
export function decide(ranked) {
  if (!ranked.length) {
    return { decision: "no_match", top: null, all: ranked };
  }

  const top = ranked[0];
  const second = ranked[1];
  const gap = second ? top.score - second.score : 100;

  if (top.score >= 85) {
    return { decision: "high", top, all: ranked };
  }

  if (top.score >= 60) {
    if (gap >= 15) {
      return { decision: "high", top, all: ranked };
    }
    return { decision: "ambiguous", top, all: ranked };
  }

  return { decision: "no_match", top: null, all: ranked };
}

/**
 * Full matching pipeline for a raw event.
 * Returns the result object to store in rawEvent.matched_notification.
 *
 * @param {string} html            — stored HTML snapshot
 * @param {{ diff_added:string, watch_url:string, watch_title:string }} context
 * @returns {{ decision, matched_notification }}
 */
export function runMatching(html, context) {
  if (isTickerOrNoiseDiff(context?.diff_added)) {
    return {
      decision: "no_match",
      matched_notification: {
        title: null,
        href: null,
        score: 0,
        method: "none",
        candidates: [],
        note: "Diff identified as dynamic ticker/clock/server status noise",
      },
    };
  }

  const candidates = extractCandidates(html);
  const ranked = rankCandidates(candidates, context);
  const { decision, top, all } = decide(ranked);

  // Keep top-5 candidates for audit (don't store entire list in Mongo)
  const topCandidates = all.slice(0, 5).map(({ title, href, score }) => ({
    title,
    href,
    score,
  }));

  if (decision === "high") {
    return {
      decision,
      matched_notification: {
        title: top.title,
        href: top.href,
        score: top.score,
        method: "deterministic",
        candidates: topCandidates,
      },
    };
  }

  if (decision === "ambiguous") {
    return {
      decision,
      matched_notification: {
        title: top.title,
        href: top.href,
        score: top.score,
        method: "pending_llm",
        candidates: topCandidates,
      },
    };
  }

  // no_match
  return {
    decision,
    matched_notification: {
      title: null,
      href: null,
      score: top ? top.score : 0,
      method: "none",
      candidates: topCandidates,
    },
  };
}
