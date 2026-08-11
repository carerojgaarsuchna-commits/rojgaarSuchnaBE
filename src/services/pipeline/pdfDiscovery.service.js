/**
 * pdfDiscovery.service.js
 * Stage 2 — Deterministic PDF discovery.
 *
 * Candidate sources (in priority order):
 *  1. Direct .pdf links in the matched row's DOM context
 *  2. Relative links resolved against watch_url
 *  3. Known government document-host patterns
 *  4. One-hop: fetch the matched href page, scan it once for PDF links
 *
 * The LLM never invents a PDF URL.
 * If top-2 candidates are within 10 points → pdf_ambiguous.
 */

import axios from "axios";
import * as cheerio from "cheerio";
import {
  containsAny,
  normalizeTitle,
  tokenSimilarity,
  adNoMatch,
  extractAdNo,
} from "../../utils/textNormalize.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const ONE_HOP_TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 3;

/** Known Indian government document hosting patterns */
const GOV_DOC_HOST_PATTERNS = [
  "upsc.gov.in",
  "ssc.nic.in",
  "ssc.gov.in",
  "indianrailways.gov.in",
  "rrb.gov.in",
  "ibps.in",
  "rbi.org.in",
  "nabard.org",
  "uiic.co.in",
  "licindia.in",
  "ongc.co.in",
  "bel-india.in",
  "drdo.gov.in",
  "barc.gov.in",
  "isro.gov.in",
  "nhm.gov.in",
  "nrhm.gov.in",
  "aiims.edu",
  "aiims.ac.in",
  "pgimer.edu.in",
  "esic.in",
  "esic.nic.in",
  "epfindia.gov.in",
  "niacl.org.in",
  "oicl.org.in",
  "hssc.gov.in",
  "bpsc.bih.nic.in",
  "mppsc.mp.gov.in",
  "ukpsc.gov.in",
  "rpsc.rajasthan.gov.in",
  "gpsc.gujarat.gov.in",
  "kpsc.kar.nic.in",
  "tnpsc.gov.in",
  "appsc.gov.in",
  "tspsc.gov.in",
  "opsc.gov.in",
  "cgpsc.cg.gov.in",
  "jhpsc.nic.in",
  "jpsc.gov.in",
];

/** Keywords in a URL that strongly suggest a PDF advertisement link */
const PDF_LINK_KEYWORDS = [
  ".pdf",
  "advt",
  "advertisement",
  "notification",
  "recruitment",
  "vacancy",
  "notice",
  "download",
  "circular",
  "press_release",
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Resolve a potentially-relative href against a base URL.
 * Returns null if resolution fails.
 * @param {string} href
 * @param {string} base
 * @returns {string|null}
 */
function resolveUrl(href, base) {
  if (!href) return null;
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

/**
 * Check if a URL is on the same host as the watch URL
 * OR on a known government document host.
 * @param {string} url
 * @param {string} watchUrl
 * @returns {boolean}
 */
function isTrustedDomain(url, watchUrl) {
  try {
    const host = new URL(url).hostname;
    const watchHost = new URL(watchUrl).hostname;

    if (host === watchHost) return true;
    if (GOV_DOC_HOST_PATTERNS.some((pattern) => host.endsWith(pattern))) return true;

    return false;
  } catch {
    return false;
  }
}

/**
 * Score a PDF candidate URL.
 * Returns 0–100.
 *
 * Factors:
 *  - Link text / URL similarity to matched title  +30
 *  - Is a .pdf extension                          +30
 *  - Trusted domain                               +20
 *  - Link text / URL matches ad number            +15
 *  - Proximity / download attribute               +5
 *
 * @param {{ url:string, linkText:string, hasDownloadAttr:boolean, inMatchedRow:boolean }} candidate
 * @param {{ matchedTitle:string, adNo:string|null, watchUrl:string }} context
 * @returns {number}
 */
function scorePdfCandidate(candidate, context) {
  const { url, linkText = "", hasDownloadAttr = false, inMatchedRow = false } = candidate;
  const { matchedTitle = "", adNo = null, watchUrl = "" } = context;

  let score = 0;
  const urlLower = url.toLowerCase();
  const textLower = linkText.toLowerCase();

  // 1. Link text or URL title similarity to matchedTitle (0–30 points)
  if (matchedTitle) {
    const textSim = tokenSimilarity(linkText || url, matchedTitle);
    score += Math.round(textSim * 0.3);
  }

  // 2. .pdf extension (0–30 points)
  if (urlLower.includes(".pdf")) score += 30;

  // 3. Trusted domain (0–20 points)
  if (isTrustedDomain(url, watchUrl)) score += 20;

  // 4. Ad number in link text or URL (0–15 points)
  const candidateAdNo = extractAdNo(`${textLower} ${urlLower}`);
  if (adNoMatch(adNo, candidateAdNo)) score += 15;

  // 5. Download attribute / found in matched row (0–10 points)
  if (hasDownloadAttr) score += 5;
  if (inMatchedRow) score += 5;

  return Math.min(score, 100);
}

/**
 * Extract PDF candidate links from a parsed HTML document.
 * @param {import('cheerio').CheerioAPI} $
 * @param {string} baseUrl
 * @param {string} matchedHref  — href from the matched notification row (used to flag inMatchedRow)
 * @returns {Array<{url,linkText,hasDownloadAttr,inMatchedRow}>}
 */
function extractPdfLinks($, baseUrl, matchedHref = "") {
  const candidates = [];

  $("a[href]").each((_, el) => {
    const $el = $(el);
    const rawHref = ($el.attr("href") || "").trim();
    const resolved = resolveUrl(rawHref, baseUrl);
    if (!resolved) return;

    const urlLower = resolved.toLowerCase();

    // Only consider links that look like PDF candidates
    if (!containsAny(urlLower, PDF_LINK_KEYWORDS)) return;

    const linkText = $el.text().trim().replace(/\s+/g, " ");
    const hasDownloadAttr = $el.attr("download") !== undefined;

    // Check if this link is in the same row/context as the matched href
    let inMatchedRow = false;
    if (matchedHref) {
      const $row = $el.closest("tr, li, div, p, td");
      const rowHtml = $row.html() || "";
      if (rowHtml.includes(matchedHref)) {
        inMatchedRow = true;
      }
    }

    candidates.push({ url: resolved, linkText, hasDownloadAttr, inMatchedRow });
  });

  return candidates;
}

/**
 * Do a one-hop fetch of the matched notification page and extract PDF links from it.
 * @param {string} pageUrl
 * @param {string} baseUrl
 * @returns {Promise<Array>}
 */
async function fetchOneHopPdfLinks(pageUrl, baseUrl) {
  try {
    const response = await axios.get(pageUrl, {
      timeout: ONE_HOP_TIMEOUT_MS,
      maxRedirects: MAX_REDIRECTS,
      headers: { "User-Agent": "RojgaarSuchna-Bot/1.0" },
      validateStatus: (s) => s >= 200 && s < 300,
    });

    const contentType = response.headers["content-type"] || "";

    // If the matched href itself IS a PDF → that IS the answer
    if (contentType.includes("pdf") || contentType.includes("octet-stream")) {
      return [{ url: pageUrl, linkText: "", hasDownloadAttr: false, inMatchedRow: true }];
    }

    if (!contentType.includes("html")) return [];

    const $ = cheerio.load(response.data);
    return extractPdfLinks($, baseUrl, "");
  } catch (err) {
    console.warn("[pdf-discovery] one-hop fetch failed for", pageUrl, "—", err.message);
    return [];
  }
}

// ─── Main exported function ───────────────────────────────────────────────────

/**
 * Discover the best PDF candidate for a matched notification.
 *
 * @param {string} html              — stored HTML snapshot
 * @param {{ matchedTitle:string, matchedHref:string, watchUrl:string, diffAdded:string }} context
 * @returns {Promise<{
 *   decision: 'found'|'ambiguous'|'not_found',
 *   pdfUrl: string|null,
 *   score: number,
 *   candidates: Array
 * }>}
 */
export async function discoverPdf(html, context) {
  const {
    matchedTitle = "",
    matchedHref = "",
    watchUrl = "",
    diffAdded = "",
  } = context;

  const adNo = extractAdNo(`${matchedTitle} ${diffAdded}`);
  const scoringContext = { matchedTitle, adNo, watchUrl };

  // ── Step 1: Extract PDF candidates from main HTML snapshot ─────────────────
  const $ = cheerio.load(html);
  const fromMain = extractPdfLinks($, watchUrl, matchedHref);

  // ── Step 2: One-hop — fetch the matched notification link ──────────────────
  let fromOneHop = [];
  const resolvedMatchedHref = resolveUrl(matchedHref, watchUrl);

  if (resolvedMatchedHref) {
    const matchedHrefLower = resolvedMatchedHref.toLowerCase();

    // If the matched href itself looks like a PDF, treat it as a direct hit
    if (matchedHrefLower.includes(".pdf")) {
      fromOneHop.push({
        url: resolvedMatchedHref,
        linkText: matchedTitle,
        hasDownloadAttr: false,
        inMatchedRow: true,
      });
    } else {
      // Fetch the linked page and scan for PDFs
      fromOneHop = await fetchOneHopPdfLinks(resolvedMatchedHref, watchUrl);
    }
  }

  // ── Step 3: Combine, deduplicate by URL, score ─────────────────────────────
  const seen = new Set();
  const allCandidates = [];

  for (const c of [...fromOneHop, ...fromMain]) {
    if (!seen.has(c.url)) {
      seen.add(c.url);
      allCandidates.push({
        ...c,
        score: scorePdfCandidate(c, scoringContext),
      });
    }
  }

  // Sort best-first
  allCandidates.sort((a, b) => b.score - a.score);

  const top = allCandidates[0];
  const second = allCandidates[1];

  // Keep top-5 for audit
  const topCandidates = allCandidates.slice(0, 5).map(({ url, linkText, score }) => ({
    url,
    linkText,
    score,
  }));

  if (!top) {
    return { decision: "not_found", pdfUrl: null, score: 0, candidates: topCandidates };
  }

  const gap = second ? top.score - second.score : 100;

  // Ambiguous: top two within 10 points AND neither is clearly a direct PDF
  if (top.score > 0 && gap <= 10 && second && top.score < 80) {
    return {
      decision: "ambiguous",
      pdfUrl: top.url,
      score: top.score,
      candidates: topCandidates,
    };
  }

  // Score too low → not found
  if (top.score < 20) {
    return { decision: "not_found", pdfUrl: null, score: top.score, candidates: topCandidates };
  }

  return {
    decision: "found",
    pdfUrl: top.url,
    score: top.score,
    candidates: topCandidates,
  };
}
