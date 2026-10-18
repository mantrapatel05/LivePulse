const mongoose = require("mongoose");

const testDatabaseName = `livepulse_test_${process.pid}`;
let testMongoUri;

function getTestMongoUri() {
  if (testMongoUri) return testMongoUri;
  const base = process.env.TEST_MONGO_URI || "mongodb://127.0.0.1:27017";
  const parsed = new URL(base);
  parsed.pathname = `/${testDatabaseName}`;
  testMongoUri = parsed.toString();
  return testMongoUri;
}

async function connect() {
  if (mongoose.connection.readyState === 1) return;
  await mongoose.connect(getTestMongoUri(), { serverSelectionTimeoutMS: 8000 });
}

async function clearDatabase() {
  const collections = Object.values(mongoose.connection.collections);
  await Promise.all(collections.map((collection) => collection.deleteMany({})));
}

async function closeDatabase() {
  const { closeRedisClient } = require("../../src/shared/redisClient");
  await closeRedisClient();
  if (mongoose.connection.readyState === 1) {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
}

module.exports = { connect, closeDatabase, clearDatabase };
