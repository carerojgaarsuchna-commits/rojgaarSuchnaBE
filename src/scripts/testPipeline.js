/**
 * testPipeline.js
 * Standalone unit tests for V3 pipeline functions.
 * Run with: node src/scripts/testPipeline.js
 * No server, no DB, no Redis required.
 */

import {
    buildEventHash,
    stripSecretFromPayload,
    cleanHtmlSnapshot,
    extractJsonFromText,
    safeToPublish,
    checkDiffEvidence,
} from "../service/webhook.service.js";

let passed = 0;
let failed = 0;

function test(label, fn) {
    try {
        fn();
        console.log(`  ✅ PASS: ${label}`);
        passed++;
    } catch (err) {
        console.error(`  ❌ FAIL: ${label}`);
        console.error(`         ${err.message}`);
        failed++;
    }
}

function assert(condition, msg) {
    if (!condition) throw new Error(msg || "Assertion failed");
}

function assertEqual(a, b, msg) {
    if (a !== b) throw new Error(msg || `Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

// ─── buildEventHash ───────────────────────────────────────────────────────────
console.log("\n── buildEventHash ──────────────────────────────────────────");

test("same inputs → same hash", () => {
    const h1 = buildEventHash("uuid-1", "2024-01-01T00:00:00Z", "some diff");
    const h2 = buildEventHash("uuid-1", "2024-01-01T00:00:00Z", "some diff");
    assertEqual(h1, h2);
});

test("different diff → different hash", () => {
    const h1 = buildEventHash("uuid-1", "2024-01-01T00:00:00Z", "diff A");
    const h2 = buildEventHash("uuid-1", "2024-01-01T00:00:00Z", "diff B");
    assert(h1 !== h2, "Hashes should differ for different diffs");
});

test("missing diffAdded → still produces consistent hash", () => {
    const h1 = buildEventHash("uuid-1", "2024-01-01T00:00:00Z");
    const h2 = buildEventHash("uuid-1", "2024-01-01T00:00:00Z", "");
    assertEqual(h1, h2);
});

// ─── stripSecretFromPayload ───────────────────────────────────────────────────
console.log("\n── stripSecretFromPayload ──────────────────────────────────");

test("removes 'secret' field from payload", () => {
    const result = stripSecretFromPayload({ watch_uuid: "abc", secret: "s3cr3t", diff: "+" });
    assert(!("secret" in result), "secret should be removed");
    assertEqual(result.watch_uuid, "abc");
    assertEqual(result.diff, "+");
});

test("handles null payload gracefully", () => {
    const result = stripSecretFromPayload(null);
    assert(typeof result === "object" && !Array.isArray(result));
    assert(Object.keys(result).length === 0);
});

test("handles missing secret field", () => {
    const result = stripSecretFromPayload({ watch_uuid: "abc" });
    assertEqual(result.watch_uuid, "abc");
});

// ─── extractJsonFromText ──────────────────────────────────────────────────────
console.log("\n── extractJsonFromText ─────────────────────────────────────");

test("extracts plain JSON object", () => {
    const raw = '{"relevant":false,"reason":"noise"}';
    const result = extractJsonFromText(raw);
    assert(result !== null, "Should extract JSON");
    const parsed = JSON.parse(result);
    assertEqual(parsed.relevant, false);
});

test("extracts JSON from markdown code fence", () => {
    const raw = "```json\n{\"relevant\":true,\"items\":[]}\n```";
    const result = extractJsonFromText(raw);
    assert(result !== null, "Should extract from fenced block");
    const parsed = JSON.parse(result);
    assertEqual(parsed.relevant, true);
});

test("extracts JSON from prose-wrapped response", () => {
    const raw = "Here is the result:\n{\"relevant\":false,\"reason\":\"only timestamps\"}\nPlease review.";
    const result = extractJsonFromText(raw);
    assert(result !== null);
    const parsed = JSON.parse(result);
    assertEqual(parsed.reason, "only timestamps");
});

test("returns null when no JSON object found", () => {
    const result = extractJsonFromText("No JSON here at all.");
    assertEqual(result, null);
});

test("handles nested objects correctly", () => {
    const raw = "{\"relevant\":true,\"items\":[{\"title\":\"SSC Result\",\"confidence\":95}]}";
    const result = extractJsonFromText(raw);
    assert(result !== null);
    const parsed = JSON.parse(result);
    assertEqual(parsed.items[0].title, "SSC Result");
});

test("returns null for empty input", () => {
    assertEqual(extractJsonFromText(""), null);
    assertEqual(extractJsonFromText(null), null);
});

// ─── cleanHtmlSnapshot ────────────────────────────────────────────────────────
console.log("\n── cleanHtmlSnapshot ───────────────────────────────────────");

test("removes script tags", () => {
    const html = "<p>Content</p><script>alert(\"xss\")</script><p>More</p>";
    const result = cleanHtmlSnapshot(html);
    assert(!result.includes("<script>"), "Should remove script tags");
    assert(result.includes("Content"), "Should keep content");
});

test("removes style tags", () => {
    const result = cleanHtmlSnapshot("<style>body{color:red}</style><p>Text</p>");
    assert(!result.includes("<style>"), "Should remove style tags");
});

test("converts relative href to absolute", () => {
    const html = "<a href=\"/pdf/notice.pdf\">Download</a>";
    const result = cleanHtmlSnapshot(html, "https://ssc.gov.in");
    assert(result.includes("https://ssc.gov.in/pdf/notice.pdf"), "Should resolve relative URL");
});

test("leaves javascript: hrefs alone", () => {
    const html = "<a href=\"javascript:void(0)\">Click</a>";
    const result = cleanHtmlSnapshot(html, "https://ssc.gov.in");
    assert(result.includes("href=\"javascript:void(0)\""), "Should not touch javascript: hrefs");
});

test("handles empty input", () => {
    assertEqual(cleanHtmlSnapshot(""), "");
    assertEqual(cleanHtmlSnapshot(null), "");
});

// ─── safeToPublish ────────────────────────────────────────────────────────────
console.log("\n── safeToPublish ───────────────────────────────────────────");

const goodItem = {
    title: "SSC GD Result 2025",
    category: "Result",
    source_url: "https://ssc.gov.in",
    confidence: 95,
    markdown_body: "# SSC GD Result 2025\n\nThe result has been declared. " + "a".repeat(100),
};

test("publishes valid high-confidence item", () => {
    assert(safeToPublish(goodItem) === true);
});

test("rejects item with relevant=false", () => {
    assert(safeToPublish({ ...goodItem, relevant: false }) === false);
});

test("rejects duplicate item", () => {
    assert(safeToPublish({ ...goodItem, is_duplicate: true }) === false);
});

test("rejects item with pdf_download_failed", () => {
    assert(safeToPublish({ ...goodItem, pdf_download_failed: true }) === false);
});

test("rejects item with confidence < 70", () => {
    assert(safeToPublish({ ...goodItem, confidence: 65 }) === false);
});

test("rejects item missing title", () => {
    const { title, ...noTitle } = goodItem;
    assert(safeToPublish(noTitle) === false);
});

test("rejects item with short markdown_body", () => {
    assert(safeToPublish({ ...goodItem, markdown_body: "Too short" }) === false);
});

test("rejects item with no markdown_body", () => {
    assert(safeToPublish({ ...goodItem, markdown_body: undefined }) === false);
});

// ─── checkDiffEvidence (Evidence Gate) ────────────────────────────────────────
// Regression tests for the exact false-positive patterns found in staging data.
console.log("\n── checkDiffEvidence (Evidence Gate) ───────────────────────");

// ── FALSE POSITIVE cases — MUST be rejected ──

test("RRB counter-only diff must reject 'Section Controller' item", () => {
    const diff = "(changed)           2 2 4 2 9 9 1 3 (Since: 1 January 2022)\n(into)           2 2 4 3 1 9 8 0 (Since: 1 January 2022)";
    const item = {
        title: "Section Controller Vacancy 2026 – RRB Bhubaneswar",
        original_title: "Section Controller",
        notification_date: "2026-07-14",
    };
    const result = checkDiffEvidence(item, diff, "diff_added");
    assert(result.valid === false, `Should reject counter-only diff (got score ${result.score})`);
});

test("Delhi HC visitor counter diff must reject 'Admit Card' item", () => {
    const diff = "(changed) Total Visits: 895,174\n(into) Total Visits: 921,052";
    const item = {
        title: "Admit Card Released for Chauffeur Skill Test Examination 2025",
        original_title: "Admit Card for Chauffeur Skill Test Examination 2025",
        notification_date: "2025-09-10",
    };
    const result = checkDiffEvidence(item, diff, "diff_added");
    assert(result.valid === false, `Should reject visitor counter diff (got score ${result.score})`);
});

test("MPPSC timestamp-only diff must reject 'State Forest Service' item", () => {
    const diff = "(changed) 17-08-2026 2:59:34\n(into) 17-08-2026 5:59:34";
    const item = {
        title: "State Forest Service Main Exam 2026 Online Application",
        original_title: "Online Application Link - State Forest Service Main Exam 2026",
        notification_date: "2026-08-17",
    };
    const result = checkDiffEvidence(item, diff, "diff_added");
    assert(result.valid === false, `Should reject timestamp-only diff (got score ${result.score})`);
});

test("HSSC 'Last Updated' date change must reject 'PST Notice' item", () => {
    const diff = "(changed) Last Updated: 17/08/26\n(into) Last Updated: 18/08/26";
    const item = {
        title: "Male Absentee Candidates: Physical Screening Test Notice for Various Posts",
        original_title: "Absentee Candidates PST Notice - Male",
        notification_date: "2026-08-18",
    };
    const result = checkDiffEvidence(item, diff, "diff_added");
    assert(result.valid === false, `Should reject Last-Updated-only diff (got score ${result.score})`);
});

test("Empty diff / null source must reject — never silently pass", () => {
    const item = {
        title: "Some Notification",
        original_title: "Some Official Title",
        notification_date: "2026-08-01",
    };
    const result = checkDiffEvidence(item, "", null);
    assert(result.valid === false, "No evidenceSource must reject");
    assertEqual(result.evidenceType, "no_source");
});

test("Weak generic words alone must not pass (score < 3)", () => {
    const diff = "(added) New recruitment notification for government jobs online application";
    const item = {
        title: "Some Recruitment Notification",
        original_title: "Recruitment for Various Posts",
        notification_date: "2026-08-01",
    };
    const result = checkDiffEvidence(item, diff, "diff_added");
    // "recruitment", "notification", "application", "government" are stop words — score must stay < 3
    assert(result.valid === false || result.score < 3,
        `Stop words alone must not achieve score >= 3 (got score ${result.score})`);
});

// ── TRUE POSITIVE cases — MUST pass ──

test("CCRAS genuine walk-in interview diff must pass (strong trigram)", () => {
    const diff = "(added) Walk in interview for the two Project Technical Support-II positions under ABIHR project at RARI, Pune\n(added)   * August 14, 2026\n(added)   * 14082026-864_0001.pdf";
    const item = {
        title: "Walk-in Interview for Project Technical Support-II (ABIHR)",
        original_title: "Walk in interview for the two Project Technical Support-II positions under ABIHR project",
        notification_date: "2026-08-14",
    };
    const result = checkDiffEvidence(item, diff, "diff_added");
    assert(result.valid === true,
        `Should pass genuine CCRAS diff (score ${result.score}, token: "${result.matchedToken}")`);
});

test("PDF filename in diff_added must pass (strong: doc pattern)", () => {
    const diff = "(added) 14082026-864_0001.pdf File size: 961 kB";
    const item = {
        title: "Walk-in Interview for Project Technical Support-II (ABIHR)",
        original_title: "14082026-864_0001.pdf",
        notification_date: "2026-08-14",
    };
    const result = checkDiffEvidence(item, diff, "diff_added");
    assert(result.valid === true, `PDF filename should pass evidence gate (score ${result.score})`);
});

test("DFCCIL tender with matching phrase must pass", () => {
    const diff = "(added) Construction And Operation Of Gati Shakti Multi Modal Cargo Terminal At Ambala";
    const item = {
        title: "Construction And Operation Of Gati Shakti Multi Modal Cargo Terminal At Ambala",
        original_title: "Construction And Operation Of Gati Shakti Multi Modal Cargo Terminal At Ambala",
        notification_date: "2026-08-15",
    };
    const result = checkDiffEvidence(item, diff, "diff_added");
    assert(result.valid === true, `DFCCIL genuine tender should pass (score ${result.score})`);
});

test("Two medium bigrams must pass when both present in diff", () => {
    const diff = "(added) junior executive electrical document verification";
    const item = {
        title: "Document Verification Schedule for Junior Executive (Electrical)",
        original_title: "Junior Executive electrical document verification schedule",
        notification_date: "2026-08-16",
    };
    const result = checkDiffEvidence(item, diff, "diff_added");
    assert(result.valid === true, `Two medium bigrams should pass (score ${result.score})`);
});

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(55)}`);
console.log(`Tests run: ${passed + failed}  |  Passed: ${passed}  |  Failed: ${failed}`);
if (failed > 0) {
    console.error("\n⚠️  Some tests failed. Review errors above.");
    process.exit(1);
} else {
    console.log("\n🎉 All tests passed!");
}
