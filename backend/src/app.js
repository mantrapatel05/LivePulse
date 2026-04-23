const express = require('express');
const cors = require('cors');

const eventRoutes = require('./routes/eventRoutes');
const sessionRoutes = require('./routes/sessionRoutes');
const projectRoutes = require('./routes/projectRoutes');

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api/events', eventRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/projects', projectRoutes);

app.get('/', (req, res) => {
    res.send('Welcome to the LivePulse API');
});

module.exports = app;
