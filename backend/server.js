require('dotenv').config();
const { initializeTracing, shutdownTracing } = require("./src/shared/tracing");
initializeTracing("livepulse-api");

const http = require('http');
const { Server } = require('socket.io');
const { createAdapter } = require("@socket.io/redis-adapter");
const { createRedisClient } = require("./src/shared/redisClient");
const { publicCorsOptions } = require("./src/config/corsOrigin");

const app = require('./src/app');
const connectDB = require('./src/config/db');
const socketHandler = require('./src/sockets/socketHandler');

const PORT = process.env.PORT || 5000;

connectDB();

const server = http.createServer(app);

//attach socket.io
const io = new Server(server, { cors: publicCorsOptions });

const pubClient = createRedisClient("socketio-pub");
const subClient = createRedisClient("socketio-sub");
io.adapter(createAdapter(pubClient, subClient));

socketHandler(io);

app.set('io', io);

server.listen(PORT, () => {
    console.log(`LivePulse backend server is running on port ${PORT}`);
});

for (const signal of ["SIGTERM", "SIGINT"]) {
    process.once(signal, () => {
        io.close(async () => {
            await Promise.allSettled([pubClient.quit(), subClient.quit(), shutdownTracing()]);
            process.exit(0);
        });
    });
}
