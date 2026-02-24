const mongoose = require('mongoose');

const ProjectSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
    },
    apiKey : {
        type: String,
        required: true,
        index: true,
        unique: true
    },
    supabaseUserId: {
        type: String,   
        required: true
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
});

module.exports = mongoose.model('Project', ProjectSchema);