const mongoose = require('mongoose');

const EventSchema = new mongoose.Schema({
    projectId : {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Project',
        required: true
    },
    sessionId : {
        type : String,
        required: true
    },
    type : {
        type : String,
        required: true
    },
    metadata : {
        type : Object
    },
    city : {
        type : String
    },
    createdAt : {
        type : Date,
        default : Date.now
    }
});

//ttl index(30 days)
EventSchema.index(
    { createdAt : 1},
    {
        expireAfterSeconds : 60 * 60 * 24 *30
    }
);

module.exports = mongoose.model('Event', EventSchema);