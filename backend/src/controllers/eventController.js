const Event = require('../models/Event');


const ingestEvent = async (req,res) => {
    try {
        const { sessionId, type, metadata, city } = req.body;

        if(!sessionId || !type){
            return res.status(400).json({message : 'sessionId and type are required fields'});
        }
/*
Emit: "new-event"
Room: project:<projectId>
Payload: event summary
 */
        const newEvent = await Event.create({
            projectId : req.project._id,
            sessionId,
            type,
            metadata,
            city
        });

        const io = req.app.get('io');
        const roomName = `project:${req.project._id}`;

        io.to(roomName).emit('new-event', { 
            eventId : newEvent._id,
            type : newEvent.type,
            city : newEvent.city,
            createdAt : newEvent.createdAt
        });

        console.log(`Emitted new-event to room ${roomName} for event ${newEvent._id}`);

        return res.status(201).json({message : 'Event ingested successfully', event : newEvent});
    } catch(error) {
        return res.status(500).json({message : 'Event ingestion failed', error : error.message});
    }
};

module.exports = {
    ingestEvent
};