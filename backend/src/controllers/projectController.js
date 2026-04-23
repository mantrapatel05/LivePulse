const crypto = require('crypto');
const mongoose = require('mongoose');
const Project = require('../models/Project');

function generateApiKey() {
    return `lp_${crypto.randomBytes(24).toString('hex')}`;
}

const createProject = async (req, res) => {
    try {
        const { name, supabaseUserId } = req.body || {};

        if (!name || !supabaseUserId) {
            return res.status(400).json({ message: 'name and supabaseUserId are required' });
        }

        const project = await Project.create({
            name: String(name).trim(),
            supabaseUserId: String(supabaseUserId).trim(),
            apiKey: generateApiKey()
        });

        return res.status(201).json({
            message: 'Project created successfully',
            project
        });
    } catch (error) {
        return res.status(500).json({
            message: 'Failed to create project',
            error: error.message
        });
    }
};

const listProjects = async (req, res) => {
    try {
        const { supabaseUserId } = req.query || {};
        const query = supabaseUserId ? { supabaseUserId } : {};

        const projects = await Project.find(query)
            .sort({ createdAt: -1 })
            .lean();

        return res.status(200).json({
            count: projects.length,
            projects
        });
    } catch (error) {
        return res.status(500).json({
            message: 'Failed to fetch projects',
            error: error.message
        });
    }
};

const rotateProjectApiKey = async (req, res) => {
    try {
        const { projectId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(projectId)) {
            return res.status(400).json({ message: 'Invalid projectId' });
        }

        const project = await Project.findById(projectId);
        if (!project) {
            return res.status(404).json({ message: 'Project not found' });
        }

        project.apiKey = generateApiKey();
        await project.save();

        return res.status(200).json({
            message: 'Project API key rotated successfully',
            project
        });
    } catch (error) {
        return res.status(500).json({
            message: 'Failed to rotate project API key',
            error: error.message
        });
    }
};

module.exports = {
    createProject,
    listProjects,
    rotateProjectApiKey
};
