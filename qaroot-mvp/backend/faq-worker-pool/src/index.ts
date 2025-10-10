import 'dotenv/config';
import amqp, { ConsumeMessage } from 'amqplib';
import { createPool } from '@qaroot/shared';
import { analyzeQuestionsWorker } from './workers/analyze-questions';

const AMQ_URL = process.env.AMQ_URL || 'amqp://localhost:5672';
const WORKER_CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY || '4', 10);
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || '3', 10);

let connection: any = null;
let channel: any = null;
let activeJobs = 0;

async function connectAMQ(): Promise<void> {
  try {
    connection = await amqp.connect(AMQ_URL);
    channel = await connection.createChannel();

    // Set prefetch to control concurrency
    await channel.prefetch(WORKER_CONCURRENCY);

    // Assert queues
    await channel.assertQueue('analyze.questions', { durable: true });

    console.log('✓ Connected to AMQ');
  } catch (error) {
    console.error('AMQ connection error:', error);
    throw error;
  }
}

async function processMessage(msg: ConsumeMessage): Promise<void> {
  if (!channel) {
    throw new Error('Channel not initialized');
  }

  activeJobs++;

  try {
    const content = JSON.parse(msg.content.toString());
    const retryCount = (msg.properties.headers?.['x-retry-count'] as number) || 0;

    console.log(`[Worker] Processing job: ${JSON.stringify(content)}`);

    // Route to appropriate worker based on queue
    if (msg.fields.routingKey === 'analyze.questions') {
      await analyzeQuestionsWorker(content);
    }

    // Acknowledge message
    channel.ack(msg);
    console.log(`[Worker] ✓ Job completed`);
  } catch (error) {
    console.error(`[Worker] Job failed:`, error);

    const retryCount = (msg.properties.headers?.['x-retry-count'] as number) || 0;

    if (retryCount < MAX_RETRIES) {
      // Retry with exponential backoff
      console.log(`[Worker] Retrying job (attempt ${retryCount + 1}/${MAX_RETRIES})`);

      const delay = Math.pow(2, retryCount) * 1000; // 1s, 2s, 4s...

      setTimeout(() => {
        if (channel) {
          channel.sendToQueue(msg.fields.routingKey, msg.content, {
            persistent: true,
            headers: {
              'x-retry-count': retryCount + 1,
            },
          });
          channel.ack(msg);
        }
      }, delay);
    } else {
      // Max retries exceeded, move to dead letter queue or log
      console.error(`[Worker] Max retries exceeded, abandoning job`);
      channel.nack(msg, false, false);
    }
  } finally {
    activeJobs--;
  }
}

async function startWorkers(): Promise<void> {
  if (!channel) {
    throw new Error('Channel not initialized');
  }

  console.log(`Starting ${WORKER_CONCURRENCY} workers...`);

  // Consume from analyze.questions queue
  await channel.consume('analyze.questions', async (msg: any) => {
    if (msg) {
      await processMessage(msg);
    }
  });

  console.log('✓ Workers started');
}

async function start() {
  try {
    console.log('Starting FAQ Worker Pool...');

    // Initialize database
    createPool();
    console.log('✓ Database pool created');

    // Connect to AMQ
    await connectAMQ();

    // Start workers
    await startWorkers();

    console.log('✓ FAQ Worker Pool ready');
  } catch (error) {
    console.error('Failed to start FAQ Worker Pool:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');

  // Wait for active jobs to complete
  const maxWait = 30000; // 30 seconds
  const startTime = Date.now();

  while (activeJobs > 0 && Date.now() - startTime < maxWait) {
    console.log(`Waiting for ${activeJobs} active jobs to complete...`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  if (activeJobs > 0) {
    console.warn(`Force closing with ${activeJobs} active jobs`);
  }

  if (channel) await channel.close();
  if (connection) await connection.close();

  process.exit(0);
});

start();
