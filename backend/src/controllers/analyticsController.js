const mongoose = require('mongoose');
const Event  = require('../models/Event');
const Session = require('../models/Session');

// GET /api/analytics/:projectId/overview
const getOverview = async (req, res) => {
    try{
        const { projectId } = req.params;
        const projectIdObj = new mongoose.Types.ObjectId(projectId);

        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        //getting today's event count
        const todayEvents = await Event.countDocuments({
            projectId : projectIdObj,
            timestamp : { $gte : startOfToday } //gte == greater than or equal to
        });


        const activeSessions = await Session.countDocuments({
            projectId : projectIdObj,
            lastSeenAt : { $gte : new Date(Date.now() - 15 * 60 * 1000)}
        });

        //get total sessions
        const totalSessions = await Session.countDocuments({
            projectId : projectIdObj
        });

        return res.status(200).json({
            todayEvents,
            activeSessions,
            totalSessions
        });

    } catch (error) {
        return res.status(500).json({
            message : 'Failed to fetch analytics overview',
            error : error.message
        });
    }
};

module.exports = { getOverview };