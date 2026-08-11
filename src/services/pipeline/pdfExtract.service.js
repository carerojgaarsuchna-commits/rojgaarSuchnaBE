/**
 * pdfExtract.service.js
 * Stage 4a — PDF text extraction.
 *
 * Primary:  pdf-parse
 * Fallback: pdfjs-dist
 *
 * Returns:
 *   { ok: true,  text, pageCount, charCount, method }
 *   { ok: false, error, method }
 */

// ─── pdf-parse (primary) ──────────────────────────────────────────────────────

/**
 * Extract text using pdf-parse.
 * @param {Buffer} buffer
 * @returns {Promise<{ok:boolean, text?:string, pageCount?:number, error?:string}>}
 */
async function extractWithPdfParse(buffer) {
  try {
    // Dynamic import so missing package fails gracefully
    const pdfParse = (await import("pdf-parse")).default;
    const result = await pdfParse(buffer);
    return {
      ok: true,
      text: result.text || "",
      pageCount: result.numpages || 1,
    };
  } catch (err) {
    return { ok: false, error: `pdf-parse: ${err.message}` };
  }
}

// ─── pdfjs-dist (fallback) ────────────────────────────────────────────────────

/**
 * Extract text using pdfjs-dist.
 * @param {Buffer} buffer
 * @returns {Promise<{ok:boolean, text?:string, pageCount?:number, error?:string}>}
 */
async function extractWithPdfjs(buffer) {
  try {
    const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const { getDocument } = pdfjsLib;

    const uint8 = new Uint8Array(buffer);
    const loadingTask = getDocument({ data: uint8 });
    const pdf = await loadingTask.promise;

    const pageCount = pdf.numPages;
    const pageTexts = [];

    for (let i = 1; i <= pageCount; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items.map((item) => item.str).join(" ");
      pageTexts.push(pageText);
    }

    return {
      ok: true,
      text: pageTexts.join("\n"),
      pageCount,
    };
  } catch (err) {
    return { ok: false, error: `pdfjs-dist: ${err.message}` };
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Extract text from a PDF buffer.
 * Tries pdf-parse first; falls back to pdfjs-dist.
 *
 * @param {Buffer} buffer
 * @returns {Promise<{
 *   ok: boolean,
 *   text?: string,
 *   pageCount?: number,
 *   charCount?: number,
 *   method: 'pdf-parse'|'pdfjs-dist'|'failed',
 *   error?: string
 * }>}
 */
export async function extractPdfText(buffer) {
  // Primary
  const primary = await extractWithPdfParse(buffer);
  if (primary.ok) {
    return {
      ok: true,
      text: primary.text,
      pageCount: primary.pageCount,
      charCount: primary.text.length,
      method: "pdf-parse",
    };
  }

  console.warn("[pdf-extract] pdf-parse failed:", primary.error, "— trying pdfjs-dist");

  // Fallback
  const fallback = await extractWithPdfjs(buffer);
  if (fallback.ok) {
    return {
      ok: true,
      text: fallback.text,
      pageCount: fallback.pageCount,
      charCount: fallback.text.length,
      method: "pdfjs-dist",
    };
  }

  console.error("[pdf-extract] both parsers failed. pdfjs error:", fallback.error);

  return {
    ok: false,
    method: "failed",
    error: `Primary: ${primary.error} | Fallback: ${fallback.error}`,
  };
}
