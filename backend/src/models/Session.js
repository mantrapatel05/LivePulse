const mongoose = require('mongoose');

const SessionSchema = new mongoose.Schema({
    projectId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Project',
        required: true,
        index: true
    },
    sessionId: {
        type: String,
        required: true
    },
    userId: {
        type: String,
        default: 'anonymous',
        index: true
    },
    startedAt: {
        type: Date,
        default: Date.now
    },
    lastSeenAt: {
        type: Date,
        default: Date.now,
        index: true
    },
    currentUrl: {
        type: String,
        default: null
    },
    lastEventType: {
        type: String,
        default: null
    },
    eventCount: {
        type: Number,
        default: 0
    },
    city: {
        type: String,
        default: null
    }
});

SessionSchema.index({ projectId: 1, sessionId: 1 }, { unique: true });

module.exports = mongoose.model('Session', SessionSchema);
