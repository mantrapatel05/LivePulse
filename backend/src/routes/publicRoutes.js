const express = require("express");
const { badgePulse, recordLandingHit } = require("../controllers/badgeController");
const { unsubscribeDigest } = require("../controllers/digestController");
const router = express.Router();

router.get("/:publicId/pulse", badgePulse);
router.post("/:publicId/landing-hit", recordLandingHit);
router.get("/digest/unsubscribe", unsubscribeDigest);
router.post("/digest/unsubscribe", unsubscribeDigest);

module.exports = router;
