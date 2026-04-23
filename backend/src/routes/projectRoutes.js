const express = require('express');
const router = express.Router();

const {
    createProject,
    listProjects,
    rotateProjectApiKey
} = require('../controllers/projectController');

router.post('/', createProject);
router.get('/', listProjects);
router.post('/:projectId/rotate-key', rotateProjectApiKey);

module.exports = router;
