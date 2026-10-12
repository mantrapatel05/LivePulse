module.exports = {
  testEnvironment: "node",
  setupFiles: ["<rootDir>/tests/helpers/env.js"],
  testTimeout: 30000,
  testPathIgnorePatterns: ["/node_modules/"],
};