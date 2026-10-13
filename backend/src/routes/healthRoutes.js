const express = require("express");
const router = express.Router();

const { liveness, readiness } = require("../controllers/healthController");

router.get("/", liveness);
router.get("/live", liveness);
router.get("/ready", readiness);

module.exports = router;
