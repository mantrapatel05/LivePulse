const express = require('express');
const router = express.Router();

const { getOverview } = require('../controllers/analyticsController');
const apiKeyAuth = require('../middleware/apiKeyAuth');

router.get('/:projectId/overview', apiKeyAuth, getOverview);

module.exports = router;
