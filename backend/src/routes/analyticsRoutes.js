const express = require('express');
const router = express.Router();

const apiKeyAuth = require('../middleware/apiKeyAuth');
const {
    getOverview,
    getTopPages,
    getEventsOverTime,
    getEventBreakdown,
    getSessionTimeline,
    getErrorClusters,
} = require('../controllers/analyticsController');

router.get('/:projectId/overview', apiKeyAuth, getOverview);

router.get('/:projectId/events-over-time', getEventsOverTime);

router.get('/:projectId/top-pages',apiKeyAuth,getTopPages);

router.get('/:projectId/event-breakdown',apiKeyAuth,getEventBreakdown);

router.get('/:projectId/sessions/:sessionId/timeline',apiKeyAuth,getSessionTimeline);

router.get('/:projectId/error-clusters',apiKeyAuth,getErrorClusters);

module.exports = router;
