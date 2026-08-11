import fs from "fs";
import {
  scoreCandidate,
  rankCandidates,
  decide,
} from "../services/pipeline/matching.service.js";
import {
  tokenSimilarity,
  normalizeTitle,
  containsAny,
} from "../utils/textNormalize.js";

const dataPath = "D:/roj-api/staging_rs.latestnotifications.json";
const records = JSON.parse(fs.readFileSync(dataPath, "utf8"));

console.log(`Loaded ${records.length} staging records.`);

// Test candidate scoring improvements
let lowScoreCount = 0;
let highScoreCount = 0;
let ippbRecord = null;

records.forEach((record, index) => {
  const p = record.webhook_payload || {};
  if (
    p.watch_title?.includes("India Post") ||
    p.watch_url?.includes("ippbonline")
  ) {
    ippbRecord = record;
  }
});

if (ippbRecord) {
  console.log("\n=== IPPB STAGING PAYLOAD ===");
  console.log("Watch Title:", ippbRecord.webhook_payload.watch_title);
  console.log("Watch URL:", ippbRecord.webhook_payload.watch_url);
  console.log("Diff added:\n", ippbRecord.webhook_payload.diff_added);
} else {
  console.log("\n(No IPPB record explicitly found in staging dataset, testing general payloads)");
}

// Check diff line token similarity vs full diff string
console.log("\n=== COMPARING FULL DIFF VS BEST-LINE MATCHING ===");
let totalGain = 0;
let testedCount = 0;

records.slice(0, 100).forEach((rec) => {
  const p = rec.webhook_payload || {};
  const diffAdded = p.diff_added || p.diff || "";
  const lines = diffAdded
    .split(/[\r\n|]+/)
    .map((l) => l.replace(/[*_]/g, "").trim())
    .filter((l) => l.length > 10);

  if (lines.length > 0) {
    const testTitle = lines[0];
    const fullDiffSim = tokenSimilarity(testTitle, diffAdded);
    const bestLineSim = Math.max(
      ...lines.map((line) => tokenSimilarity(testTitle, line))
    );

    totalGain += bestLineSim - fullDiffSim;
    testedCount++;
  }
});

console.log(
  `Average similarity score improvement using best-line matching across 100 payloads: +${Math.round(
    totalGain / testedCount
  )} points!`
);
