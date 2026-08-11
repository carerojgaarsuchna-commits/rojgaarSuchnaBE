/**
 * pdfDownload.service.js
 * Stage 3 — Verified PDF download with SSRF protection.
 *
 * Security checks (each is its own function — readable, testable):
 *  1. Block private IPs / localhost (SSRF)
 *  2. Verify Content-Type includes "pdf"
 *  3. Verify %PDF- magic bytes
 *  4. Enforce max size (15 MB)
 *  5. Limit redirects to 3
 *
 * Returns: { buffer, sha256, url, size_bytes, content_type }
 */

import axios from "axios";
import crypto from "crypto";
import { URL } from "url";
import dns from "dns/promises";

// ─── Configuration ────────────────────────────────────────────────────────────

const MAX_PDF_SIZE_BYTES = 15 * 1024 * 1024; // 15 MB
const MAX_REDIRECTS = 3;
const DOWNLOAD_TIMEOUT_MS = 30000; // 30 seconds

// ─── SSRF Protection ──────────────────────────────────────────────────────────

/** Private / link-local IPv4 ranges to block */
const PRIVATE_IPV4_RANGES = [
  /^10\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^192\.168\./,
  /^127\./,
  /^169\.254\./, // link-local
  /^0\./,        // invalid
];

/** Cloud metadata endpoints to block */
const BLOCKED_HOSTNAMES = [
  "metadata.google.internal",
  "169.254.169.254", // AWS/GCP/Azure IMDS
  "metadata.azure.internal",
];

/**
 * Check if an IP address is in a private/blocked range.
 * @param {string} ip
 * @returns {boolean}
 */
function isPrivateIp(ip) {
  return PRIVATE_IPV4_RANGES.some((re) => re.test(ip));
}

/**
 * Resolve hostname and verify it does NOT point to a private/internal IP.
 * Throws if SSRF risk detected.
 * @param {string} hostname
 */
async function assertNotSsrf(hostname) {
  if (BLOCKED_HOSTNAMES.includes(hostname.toLowerCase())) {
    throw new Error(`SSRF blocked: hostname "${hostname}" is on the blocklist`);
  }

  let addresses;
  try {
    const result = await dns.lookup(hostname, { all: true });
    addresses = result.map((r) => r.address);
  } catch {
    throw new Error(`SSRF check: DNS resolution failed for "${hostname}"`);
  }

  for (const ip of addresses) {
    if (isPrivateIp(ip)) {
      throw new Error(`SSRF blocked: "${hostname}" resolves to private IP ${ip}`);
    }
  }
}

// ─── Validators ───────────────────────────────────────────────────────────────

/**
 * Verify Content-Type header contains "pdf".
 * @param {string} contentType
 */
function assertPdfContentType(contentType = "") {
  const lower = contentType.toLowerCase();
  if (!lower.includes("pdf") && !lower.includes("octet-stream")) {
    throw new Error(`Invalid Content-Type: expected PDF, got "${contentType}"`);
  }
}

/**
 * Verify PDF magic bytes (%PDF-) at the start of the buffer.
 * @param {Buffer} buffer
 */
function assertPdfMagicBytes(buffer) {
  if (!buffer || buffer.length < 5) {
    throw new Error("PDF buffer too small to verify magic bytes");
  }
  const magic = buffer.slice(0, 5).toString("ascii");
  if (magic !== "%PDF-") {
    throw new Error(`Invalid PDF magic bytes: got "${magic}" instead of "%PDF-"`);
  }
}

/**
 * Verify the buffer does not exceed the max size limit.
 * @param {Buffer} buffer
 */
function assertPdfSize(buffer) {
  if (buffer.length > MAX_PDF_SIZE_BYTES) {
    throw new Error(
      `PDF too large: ${buffer.length} bytes (max ${MAX_PDF_SIZE_BYTES} bytes)`
    );
  }
}

// ─── Main download function ───────────────────────────────────────────────────

/**
 * Download and verify a PDF from a URL.
 *
 * @param {string} pdfUrl
 * @returns {Promise<{buffer:Buffer, sha256:string, url:string, size_bytes:number, content_type:string}>}
 * @throws {Error} on SSRF, invalid content, too large, etc.
 */
export async function downloadVerifiedPdf(pdfUrl) {
  // 1. Parse URL
  let parsedUrl;
  try {
    parsedUrl = new URL(pdfUrl);
  } catch {
    throw new Error(`Invalid PDF URL: "${pdfUrl}"`);
  }

  // 2. Only allow HTTP/HTTPS
  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new Error(`Disallowed protocol: "${parsedUrl.protocol}"`);
  }

  // 3. SSRF check
  await assertNotSsrf(parsedUrl.hostname);

  // 4. Download with axios (responseType: arraybuffer for binary)
  let response;
  try {
    response = await axios.get(pdfUrl, {
      responseType: "arraybuffer",
      timeout: DOWNLOAD_TIMEOUT_MS,
      maxRedirects: MAX_REDIRECTS,
      headers: { "User-Agent": "RojgaarSuchna-Bot/1.0" },
      validateStatus: (status) => status >= 200 && status < 300,
    });
  } catch (err) {
    if (err.response) {
      throw new Error(`PDF download failed: HTTP ${err.response.status} from "${pdfUrl}"`);
    }
    throw new Error(`PDF download error: ${err.message}`);
  }

  const buffer = Buffer.from(response.data);
  const contentType = response.headers["content-type"] || "";

  // 5. Content-Type check
  assertPdfContentType(contentType);

  // 6. Magic bytes check
  assertPdfMagicBytes(buffer);

  // 7. Size check
  assertPdfSize(buffer);

  // 8. Compute SHA-256
  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");

  // Use the final URL (after redirects) if available
  const finalUrl = response.request?.res?.responseUrl || pdfUrl;

  return {
    buffer,
    sha256,
    url: finalUrl,
    size_bytes: buffer.length,
    content_type: contentType,
  };
}
