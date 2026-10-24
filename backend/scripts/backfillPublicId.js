require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../src/config/db");
const Project = require("../src/models/Project");
const { generatePublicId } = require("../src/shared/publicId");

const MISSING = { $or: [{ publicId: { $exists: false } }, { publicId: null }] };

async function backfillPublicIds({ ProjectModel = Project, generate = generatePublicId, batchSize = 200 } = {}) {
  let assigned = 0;
  for (;;) {
    const batch = await ProjectModel.find(MISSING).select("_id").limit(batchSize).lean();
    if (!batch.length) break;
    let passAssigned = 0;
    for (const { _id } of batch) {
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          const res = await ProjectModel.updateOne({ _id, ...MISSING }, { $set: { publicId: generate() } });
          if (res.modifiedCount) { assigned++; passAssigned++; }
          break;
        } catch (err) {
          if (err && err.code === 11000 && attempt < 4) continue; // id collision: regenerate
          throw err;
        }
      }
    }
    if (passAssigned === 0) throw new Error("backfill made no progress; aborting to avoid an infinite loop");
  }
  return assigned;
}

async function run() {
  await connectDB();
  const n = await backfillPublicIds();
  console.log(`assigned publicId to ${n} project(s)`);
  await mongoose.disconnect();
}

if (require.main === module) {
  run().then(() => process.exit(0)).catch((err) => { console.error("backfill failed:", err); process.exit(1); });
}

module.exports = { backfillPublicIds };
