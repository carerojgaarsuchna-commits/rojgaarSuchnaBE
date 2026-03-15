import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const OLD_URL = process.env.OLD_URL || "https://sarkariresult.com.cm";
const NEW_URL = process.env.NEW_URL || "https://rojgaarsuchna.com/";
const BATCH_SIZE = Number(process.env.BATCH_SIZE || 500);

const MONGO_URI = process.env.MONGO_URI;
const MONGO_DB = process.env.MONGO_DB || "rojaar";

const args = process.argv.slice(2);
const isDryRun = args.includes("--dry-run");
const allCollections = args.includes("--all");
const explicitCollections = args.filter((arg) => !arg.startsWith("--"));

if (!MONGO_URI) {
  console.error("Missing MONGO_URI in environment.");
  process.exit(1);
}

if (!allCollections && explicitCollections.length === 0) {
  console.error("Usage: npm run replace-domain -- <collection1> [collection2 ...] [--dry-run] OR --all [--dry-run]");
  process.exit(1);
}

function deepReplace(value) {
  if (typeof value === "string") {
    return value.includes(OLD_URL) ? value.split(OLD_URL).join(NEW_URL) : value;
  }

  if (Array.isArray(value)) {
    return value.map(deepReplace);
  }

  if (value && typeof value === "object") {
    // Keep BSON/native object instances intact (ObjectId, Date, Buffer, etc.)
    if (value.constructor !== Object) {
      return value;
    }

    for (const key of Object.keys(value)) {
      value[key] = deepReplace(value[key]);
    }
  }

  return value;
}

async function processCollection(collectionName) {
  const collection = mongoose.connection.db.collection(collectionName);
  const cursor = collection.find({});

  let scanned = 0;
  let changed = 0;
  let ops = [];

  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    scanned += 1;

    const before = JSON.stringify(doc);
    const replacement = deepReplace(doc);
    const after = JSON.stringify(replacement);

    if (before !== after) {
      changed += 1;
      if (!isDryRun) {
        ops.push({
          replaceOne: {
            filter: { _id: doc._id },
            replacement,
          },
        });

        if (ops.length >= BATCH_SIZE) {
          await collection.bulkWrite(ops, { ordered: false });
          ops = [];
        }
      }
    }
  }

  if (!isDryRun && ops.length > 0) {
    await collection.bulkWrite(ops, { ordered: false });
  }

  await cursor.close();
  return { scanned, changed };
}

async function main() {
  await mongoose.connect(MONGO_URI, { dbName: MONGO_DB });

  try {
    let collectionNames = explicitCollections;
    if (allCollections) {
      const collections = await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray();
      collectionNames = collections
        .map((item) => item.name)
        .filter((name) => !name.startsWith("system."));
    }

    let totalScanned = 0;
    let totalChanged = 0;

    for (const collectionName of collectionNames) {
      const { scanned, changed } = await processCollection(collectionName);
      totalScanned += scanned;
      totalChanged += changed;
      console.log(`${collectionName}: scanned=${scanned}, changed=${changed}${isDryRun ? " (dry-run)" : ""}`);
    }

    console.log(`Done. scanned=${totalScanned}, changed=${totalChanged}${isDryRun ? " (dry-run)" : ""}`);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch(async (err) => {
  console.error("replace-domain script failed:", err);
  try {
    await mongoose.disconnect();
  } catch {
    // ignore disconnect errors
  }
  process.exit(1);
});

