require('dotenv').config();
const http = require('http');
const { Server } = require('socket.io');
const { createAdapter } = require("@socket.io/redis-adapter");
const { createRedisClient } = require("./src/shared/redisClient");

const app = require('./src/app');
const connectDB = require('./src/config/db');
const socketHandler = require('./src/sockets/socketHandler');

const PORT = process.env.PORT || 5000;

connectDB();

const server = http.createServer(app);

//attach socket.io
const io = require('socket.io')(server, {
    cors : {
        origin : '*'
    }
});

const pubClient = createRedisClient("socketio-pub");
const subClient = createRedisClient("socketio-sub");
io.adapter(createAdapter(pubClient, subClient));

socketHandler(io);

app.set('io', io);

server.listen(PORT, () => {
    console.log(`LivePulse backend server is running on port ${PORT}`);
});