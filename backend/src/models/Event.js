const mongoose = require('mongoose');

const EventSchema = new mongoose.Schema({
    projectId : {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Project',
        required: true
    },
    sessionId : {
        type : String,
        required: true,
        index: true
    },
    userId: {
        type: String,
        default: 'anonymous',
        index: true
    },
    eventType : {
        type : String,
        required: true,
        enum: ['page_view', 'click', 'error', 'rage_click', 'custom', 'time_on_page', 'scroll_depth']
    },
    url: {
        type: String,
        required: true
    },
    element: {
        type: String,
        default: null
    },
    timestamp: {
        type: Date,
        default: Date.now,
        index: true
    },
    metadata : {
        type : mongoose.Schema.Types.Mixed,
        default: {}
    },
    city : {
        type : String
    },
    receivedAt : {
        type : Date,
        default : Date.now
    }
});

//ttl index(30 days)
EventSchema.index(
    { receivedAt : 1},
    {
        expireAfterSeconds : 60 * 60 * 24 *30
    }
);

module.exports = mongoose.model('Event', EventSchema);
