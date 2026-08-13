const Event = require('../models/Event');
const Session = require('../models/Session');

function assertProjectMatch(req, res) {
  if (String(req.project._id) !== String(req.params.projectId)) {
    res.status(403).json({ message: 'API key does not match this project' });
    return false;
  }
  return true;
}

const getOverview = async (req, res) => {
  try {
    if (!assertProjectMatch(req, res)) return;
    const projectId = req.project._id;

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000);

    // Promise.all — these three counts don't depend on each other,
    // so run them concurrently instead of one-by-one.
    const [todayEvents, activeSessions, totalSessions] = await Promise.all([
      Event.countDocuments({ projectId, timestamp: { $gte: startOfToday } }),
      Session.countDocuments({ projectId, lastSeenAt: { $gte: fifteenMinAgo } }),
      Session.countDocuments({ projectId })
    ]);

    return res.status(200).json({ todayEvents, activeSessions, totalSessions });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch analytics overview', error: error.message });
  }
};

const getTopPages = async (req, res) => {
  try {
    if (!assertProjectMatch(req, res)) return;
    const projectId = req.project._id;
    const hours = Number(req.query.hours) || 24;
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    const topPages = await Event.aggregate([
      { $match: { projectId, timestamp: { $gte: since }, eventType: 'page_view' } },
      // $addToSet collects DISTINCT sessionIds per url — lets us report
      // "unique sessions" per page, not just raw view count.
      { $group: { _id: '$url', views: { $sum: 1 }, sessions: { $addToSet: '$sessionId' } } },
      { $project: { url: '$_id', _id: 0, views: 1, sessions: { $size: '$sessions' } } },
      { $sort: { views: -1 } },
      { $limit: 10 }
    ]);

    return res.status(200).json({ hours, topPages });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch top pages', error: error.message });
  }
};

const getEventsOverTime = async (req, res) => {
  try {
    if (!assertProjectMatch(req, res)) return;
    const projectId = req.project._id;
    const hours = Number(req.query.hours) || 1;
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    const series = await Event.aggregate([
      { $match: { projectId, timestamp: { $gte: since } } },
      {
        // buckets every timestamp down to the minute so 10:03:47 and
        // 10:03:12 land in the same "10:03" bucket for a sparkline chart
        $group: {
          _id: { $dateTrunc: { date: '$timestamp', unit: 'minute' } },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } },
      { $project: { _id: 0, t: '$_id', count: 1 } }
    ]);

    return res.status(200).json({ hours, series });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch events over time', error: error.message });
  }
};

const getEventBreakdown = async (req, res) => {
  try {
    if (!assertProjectMatch(req, res)) return;
    const projectId = req.project._id;
    const hours = Number(req.query.hours) || 24;
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    const breakdown = await Event.aggregate([
      { $match: { projectId, timestamp: { $gte: since } } },
      { $group: { _id: '$eventType', count: { $sum: 1 } } },
      { $project: { _id: 0, eventType: '$_id', count: 1 } },
      { $sort: { count: -1 } }
    ]);

    return res.status(200).json({ hours, breakdown });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch breakdown', error: error.message });
  }
};

const getSessionTimeline = async (req, res) => {
  try {
    if (!assertProjectMatch(req, res)) return;
    const { sessionId } = req.params;

    const events = await Event.find({ projectId: req.project._id, sessionId })
      .sort({ timestamp: 1 }) // oldest first — reads like the session's story
      .limit(500)
      .lean();

    return res.status(200).json({ sessionId, count: events.length, events });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch session timeline', error: error.message });
  }
};

const getErrorClusters = async (req, res) => {
  try {
    if (!assertProjectMatch(req, res)) return;
    const projectId = req.project._id;
    const since = new Date(Date.now() - 60 * 60 * 1000); // last 1 hour

    const clusters = await Event.aggregate([
      { $match: { projectId, eventType: 'error', timestamp: { $gte: since } } },
      {
        $group: {
          _id: '$metadata.message',
          occurrences: { $sum: 1 },
          affectedSessions: { $addToSet: '$sessionId' }
        }
      },
      {
        $project: {
          _id: 0,
          message: '$_id',
          occurrences: 1,
          affectedUsers: { $size: '$affectedSessions' }
        }
      },
      { $sort: { occurrences: -1 } }
    ]);

    return res.status(200).json({ clusters });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch error clusters', error: error.message });
  }
};

module.exports = {
  getOverview,
  getTopPages,
  getEventsOverTime,
  getEventBreakdown,
  getSessionTimeline,
  getErrorClusters
};