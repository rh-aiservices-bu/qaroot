import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createPool, runMigrations } from '@qaroot/shared';
import { connectAMQ, closeAMQ } from './services/queue';

// Import routes
import authRoutes from './routes/auth';
import sessionsRoutes from './routes/sessions';
import chatRoutes from './routes/chat';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiting (disabled in development)
if (process.env.NODE_ENV === 'production') {
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
  });
  app.use('/api/', limiter);
}

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'api-service' });
});

// Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/sessions', sessionsRoutes);
app.use('/api/v1/sessions', chatRoutes);

// Error handler
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Initialize and start server
async function start() {
  try {
    console.log('Starting API Service...');

    // Initialize database
    createPool();
    console.log('✓ Database pool created');

    // Run migrations
    if (process.env.RUN_MIGRATIONS === 'true') {
      await runMigrations();
    }

    // Connect to AMQ
    await connectAMQ();

    // Start server
    app.listen(PORT, () => {
      console.log(`✓ API Service listening on port ${PORT}`);
      console.log(`  Environment: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (error) {
    console.error('Failed to start API Service:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  await closeAMQ();
  process.exit(0);
});

start();
