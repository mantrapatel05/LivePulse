require('dotenv').config();
const http = require('http');
const app = require('./src/app');
const connectDB = require('./src/config/db');
const { connect } = require('http2');

const PORT = process.env.PORT || 5000;

connectDB();

const server = http.createServer(app);

server.listen(PORT, () => {
    console.log(`LivePulse backend server is running on port ${PORT}`);
});