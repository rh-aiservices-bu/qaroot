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

// CORS configuration - allow all origins in production
const corsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    // Allow all origins
    callback(null, true);
  },
  credentials: true,
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Trust proxy headers from OpenShift/Kubernetes
app.set('trust proxy', true);

// Rate limiting (disabled in development)
if (process.env.NODE_ENV === 'production') {
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // limit each IP to 1000 requests per windowMs (increased for development)
    standardHeaders: true,
    legacyHeaders: false,
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

    // Start server FIRST so health checks pass
    app.listen(PORT, () => {
      console.log(`✓ API Service listening on port ${PORT}`);
      console.log(`  Environment: ${process.env.NODE_ENV || 'development'}`);
    });

    // Connect to AMQ asynchronously (don't block startup)
    connectAMQ().catch(err => {
      console.error('AMQ connection failed, will retry:', err.message);
      // Could add retry logic here
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
