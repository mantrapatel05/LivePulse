const express = require('express');
const cors = require('cors');

const eventRoutes = require('./routes/eventRoutes');

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api/events', eventRoutes);

app.get('/', (req, res) => {
    res.send('Welcome to the LivePulse API');
});

module.exports = app;