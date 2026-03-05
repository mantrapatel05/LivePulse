const express = require('express');
const router = express.Router();

const { getActiveSessions } = require('../controllers/sessionController');
const apiKeyAuth = require('../middleware/apiKeyAuth');

router.get('/active', apiKeyAuth, getActiveSessions);

module.exports = router;
