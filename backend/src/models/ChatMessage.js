const mongoose = require('mongoose');

const ChatMessageSchema = new mongoose.Schema({
    projectId : {
        type : mongoose.Schema.ObjectId,
        red : 'Project',
        required : true,
        index : true
    },
    sessionId : {
        type : String,
        required : true,
        index : true
    },
    sender : {
        type : String,
        required : true,
        enum : ['founder','user']
    },
    message : {
        type : String,
        required : true,
        trim : true,
        maxlength : 2000
    },
    createdAt : {
        type : Date,
        default : Date.now,
        index : true
    }
});

ChatMessageSchema.index({projectId : 1, sessionId : 1, createdAt : 1});

module.exports = mongoose.model('ChatMessage',ChatMessageSchema);