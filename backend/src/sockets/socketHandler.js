module.exports = (io) => {
    io.on('connection',(socket) => {
        console.log('New client connected:', socket.id);

        //founder joinging their project room
        socket.on('joinProject', (projectId) => {
            const roomName = `project:${projectId}`;
            socket.join(roomName);
            console.log(`Socket ${socket.id} joined room ${roomName}`);
        });
        
        socket.on('disconnect', () => {
            console.log('Client disconnected:', socket.id);
        });
    });
}