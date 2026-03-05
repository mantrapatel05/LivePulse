const Event = require('../models/Event');
const Session = require('../models/Session');


const ingestEvent = async (req,res) => {
    try {
        const body = req.body || {};

        // Accept both snake_case and camelCase payloads for SDK compatibility.
        const sessionId = body.sessionId || body.session_id;
        const userId = body.userId || body.user_id || 'anonymous';
        const eventType = body.eventType || body.event_type || body.type;
        const url = body.url || body?.metadata?.url;
        const element = body.element || body?.metadata?.element || null;
        const timestamp = body.timestamp || body?.metadata?.timestamp || new Date().toISOString();
        const metadata = body.metadata || {};
        const city = body.city || null;
        const parsedTimestamp = new Date(timestamp);

        if(!sessionId || !eventType || !url){
            return res.status(400).json({
                message : 'sessionId, eventType, and url are required fields'
            });
        }

        if (Number.isNaN(parsedTimestamp.getTime())) {
            return res.status(400).json({ message: 'timestamp must be a valid ISO8601 date string' });
        }
/*
Emit: "new-event"
Room: project:<projectId>
Payload: event summary
 */
        const newEvent = await Event.create({
            projectId : req.project._id,
            sessionId,
            userId,
            eventType,
            url,
            element,
            timestamp: parsedTimestamp,
            metadata,
            city
        });
        
        const session = await Session.findOneAndUpdate(
            { projectId: req.project._id, sessionId },
            {
                $set: {
                    userId,
                    lastSeenAt: parsedTimestamp,
                    currentUrl: url,
                    lastEventType: eventType,
                    city
                },
                $setOnInsert: {
                    startedAt: parsedTimestamp
                },
                $inc: {
                    eventCount: 1
                }
            },
            { upsert: true, new: true }
        );

        const io = req.app.get('io');
        const roomName = `project:${req.project._id}`;

        io.to(roomName).emit('new-event', { 
            eventId : newEvent._id,
            sessionId: newEvent.sessionId,
            userId: newEvent.userId,
            eventType : newEvent.eventType,
            url: newEvent.url,
            element: newEvent.element,
            city : newEvent.city,
            timestamp : newEvent.timestamp
        });

        io.to(roomName).emit('session-updated', {
            sessionId: session.sessionId,
            userId: session.userId,
            currentUrl: session.currentUrl,
            lastEventType: session.lastEventType,
            lastSeenAt: session.lastSeenAt,
            eventCount: session.eventCount,
            city: session.city
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
