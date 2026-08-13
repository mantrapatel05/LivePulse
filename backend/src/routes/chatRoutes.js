const express = require('express');
const router = express.Router();

const { getChatHistory } = require('../controllers/chatController');
const apiKeyAuth = require('../middleware/apiKeyAuth');

router.get('/:sessionId/history', apiKeyAuth, getChatHistory);

module.exports = router;