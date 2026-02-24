const express = require('express');
const router = express.Router();

const  { ingestEvent } =  require('../controllers/eventController');
const apiKeyAuth = require('../middleware/apiKeyAuth');

router.post('/ingest', apiKeyAuth, ingestEvent);

module.exports = router;