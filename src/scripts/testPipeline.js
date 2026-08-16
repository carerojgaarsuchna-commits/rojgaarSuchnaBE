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
    const raw = '```json\n{"relevant":true,"items":[]}\n```';
    const result = extractJsonFromText(raw);
    assert(result !== null, "Should extract from fenced block");
    const parsed = JSON.parse(result);
    assertEqual(parsed.relevant, true);
});

test("extracts JSON from prose-wrapped response", () => {
    const raw = 'Here is the result:\n{"relevant":false,"reason":"only timestamps"}\nPlease review.';
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
    const raw = '{"relevant":true,"items":[{"title":"SSC Result","confidence":95}]}';
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
    const html = '<p>Content</p><script>alert("xss")</script><p>More</p>';
    const result = cleanHtmlSnapshot(html);
    assert(!result.includes("<script>"), "Should remove script tags");
    assert(result.includes("Content"), "Should keep content");
});

test("removes style tags", () => {
    const result = cleanHtmlSnapshot("<style>body{color:red}</style><p>Text</p>");
    assert(!result.includes("<style>"), "Should remove style tags");
});

test("converts relative href to absolute", () => {
    const html = '<a href="/pdf/notice.pdf">Download</a>';
    const result = cleanHtmlSnapshot(html, "https://ssc.gov.in");
    assert(result.includes("https://ssc.gov.in/pdf/notice.pdf"), "Should resolve relative URL");
});

test("leaves javascript: hrefs alone", () => {
    const html = '<a href="javascript:void(0)">Click</a>';
    const result = cleanHtmlSnapshot(html, "https://ssc.gov.in");
    assert(result.includes('href="javascript:void(0)"'), "Should not touch javascript: hrefs");
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

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(55)}`);
console.log(`Tests run: ${passed + failed}  |  Passed: ${passed}  |  Failed: ${failed}`);
if (failed > 0) {
    console.error("\n⚠️  Some tests failed. Review errors above.");
    process.exit(1);
} else {
    console.log("\n🎉 All tests passed!");
}
