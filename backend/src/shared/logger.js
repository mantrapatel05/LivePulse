const pino =  require("pino")

const baseLogger = pino({
    level: process.env.LOG_LEVEL || "info",
    base : { service : process.env.SERVICE_NAME || "livepulse-backend"},
    timestamp: pino.stdTimeFunctions.isoTime,
});

function withCorrelation(correlationId, extra = {}){
    return baseLogger.child({ correlationId, ...extra});
}

module.exports = {
    logger : baseLogger,withCorrelation
}