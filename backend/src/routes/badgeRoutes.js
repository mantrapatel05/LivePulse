const express = require("express");
const { badgeSvg } = require("../controllers/badgeController");
const router = express.Router();

router.get("/:file", (req, res, next) => {
  const m = /^([1-9A-HJ-NP-Za-km-z]{12})\.svg$/.exec(req.params.file || "");
  if (!m) return res.status(404).type("text/plain").send("not found");
  req.params.publicId = m[1];
  return badgeSvg(req, res, next);
});

module.exports = router;
