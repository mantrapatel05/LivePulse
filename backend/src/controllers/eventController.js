const Event = require('../models/Event');


const ingestEvent = async (req,res) => {
    try {
        const { sessionId, type, metadata, city } = req.body;

        if(!sessionId || !type){
            return res.status(400).json({message : 'sessionId and type are required fields'});
        }

        const newEvent = await Event.create({
            projectId : req.project._id,
            sessionId,
            type,
            metadata,
            city
        });

        return res.status(201).json({message : 'Event ingested successfully', event : newEvent});
    } catch(error) {
        return res.status(500).json({message : 'Event ingestion failed', error : error.message});
    }
};

module.exports = {
    ingestEvent
};