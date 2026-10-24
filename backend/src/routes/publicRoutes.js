const express = require("express");
const { badgePulse, recordLandingHit } = require("../controllers/badgeController");
const router = express.Router();

router.get("/:publicId/pulse", badgePulse);
router.post("/:publicId/landing-hit", recordLandingHit);

module.exports = router;
