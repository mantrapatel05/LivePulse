const express = require("express");
const router = express.Router();

const { ingestEvent } = require("../controllers/eventController");
const apiKeyAuth = require("../middleware/apiKeyAuth");
const { ingestRateLimit } = require("../middleware/rateLimit");

router.post("/ingest", apiKeyAuth, ingestRateLimit, ingestEvent);

module.exports = router;
