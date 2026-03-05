const Session = require('../models/Session');

const getActiveSessions = async (req, res) => {
    try {
        const windowMinutesRaw = Number(req.query.windowMinutes || 15);
        const windowMinutes = Number.isFinite(windowMinutesRaw) && windowMinutesRaw > 0
            ? Math.min(windowMinutesRaw, 1440)
            : 15;

        const cutoff = new Date(Date.now() - windowMinutes * 60 * 1000);

        const sessions = await Session.find({
            projectId: req.project._id,
            lastSeenAt: { $gte: cutoff }
        })
            .sort({ lastSeenAt: -1 })
            .limit(200)
            .lean();

        return res.status(200).json({
            windowMinutes,
            count: sessions.length,
            sessions
        });
    } catch (error) {
        return res.status(500).json({
            message: 'Failed to fetch active sessions',
            error: error.message
        });
    }
};

module.exports = {
    getActiveSessions
};
