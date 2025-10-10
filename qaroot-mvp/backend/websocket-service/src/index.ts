import 'dotenv/config';
import { createServer } from 'http';
import { Server, Socket } from 'socket.io';
import { createPool } from '@qaroot/shared';
import { createRedisClient, createRedisPubSub, closeRedis } from './services/redis';
import { handleQuestionEvents } from './handlers/question';
import { handleParticipantEvents } from './handlers/participant';
import { handleHostEvents } from './handlers/host';

const PORT = process.env.PORT || 3001;

// Create HTTP server
const httpServer = createServer();

// Create Socket.io server
const io = new Server(httpServer, {
  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
    credentials: true,
  },
  transports: ['websocket', 'polling'],
});

// Redis adapter for multi-pod support
const { pub, sub } = createRedisPubSub();

io.on('connection', (socket: Socket) => {
  console.log(`Client connected: ${socket.id}`);

  // Register event handlers
  handleQuestionEvents(io, socket);
  handleParticipantEvents(io, socket);
  handleHostEvents(io, socket);

  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
  });

  socket.on('error', (error) => {
    console.error(`Socket error for ${socket.id}:`, error);
  });
});

// Health check endpoint
httpServer.on('request', (req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'websocket-service' }));
  }
});

async function start() {
  try {
    console.log('Starting WebSocket Service...');

    // Initialize database pool
    createPool();
    console.log('✓ Database pool created');

    // Initialize Redis
    createRedisClient();

    // Start server
    httpServer.listen(PORT, () => {
      console.log(`✓ WebSocket Service listening on port ${PORT}`);
      console.log(`  Environment: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (error) {
    console.error('Failed to start WebSocket Service:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');

  io.close(() => {
    console.log('Socket.io server closed');
  });

  await closeRedis();

  // Don't close database pool in dev mode (tsx watch will restart)
  if (process.env.NODE_ENV === 'production') {
    const { closePool } = await import('@qaroot/shared');
    await closePool();
  }

  process.exit(0);
});

start();
