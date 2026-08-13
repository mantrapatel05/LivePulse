const ChatMessage = require('../models/ChatMessage');

const getChatHistory = async(req, res) => {
    try {
        const { sessionId } = req.params;
        const messages = await ChatMessage.find({ projectId : req.project._id, sessionId})
           .sort({createdAt : 1})
           .limit(200)
           .lean();

        return res.status(200).json({sessionId, count : messages.length, messages});
    } catch(error) {
        return res.status(500).json({message : 'failed to fetch chat history'});
    }
};

module.exports = { getChatHistory }; 