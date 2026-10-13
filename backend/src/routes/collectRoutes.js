const express = require("express");
const router = express.Router();

const { collect } = require("../controllers/collectController");
const apiKeyAuth = require("../middleware/apiKeyAuth");
const { ingestRateLimit } = require("../middleware/rateLimit");

router.post("/", apiKeyAuth, ingestRateLimit, collect);

module.exports = router;
