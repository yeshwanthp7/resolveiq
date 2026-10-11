import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { env } from './config/env.js';
import { createApp } from './app.js';
import { connectDB } from './config/db.js';
import { seedInitialData } from './config/seed.js';
import { registerSocketServer } from './services/socketService.js';

const app = createApp();
const server = http.createServer(app);

// Initialize Socket.IO with dynamic origin support
export const io = new SocketIOServer(server, {
  cors: {
    origin: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
    credentials: true,
  },
});

registerSocketServer(io);

io.on('connection', (socket) => {
  console.log(`[Socket.IO] Responder terminal connected: ${socket.id}`);

  socket.on('disconnect', () => {
    console.log(`[Socket.IO] Responder terminal disconnected: ${socket.id}`);
  });
});

async function start() {
  try {
    // 1. Establish database connection
    await connectDB();

    // 2. Run idempotent database seeding
    await seedInitialData();

    // 3. Start HTTP server
    server.listen(env.PORT, () => {
      console.log(`[ResolveIQ Server] Active and listening on port ${env.PORT}`);
      console.log(`[ResolveIQ Server] Environment: ${env.NODE_ENV}`);
      console.log(`[ResolveIQ Server] Health Check: http://localhost:${env.PORT}/api/health`);
    });
  } catch (err) {
    console.error('[ResolveIQ Server] Fatal startup error:', err.message);
    process.exit(1);
  }
}

if (process.env.NODE_ENV !== 'test') {
  start();
}

export { server, app };
