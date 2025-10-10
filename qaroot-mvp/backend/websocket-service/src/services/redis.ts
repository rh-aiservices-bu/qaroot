import Redis from 'ioredis';

let redisClient: Redis | null = null;
let redisPubClient: Redis | null = null;
let redisSubClient: Redis | null = null;

export function createRedisClient(): Redis {
  if (redisClient) {
    return redisClient;
  }

  redisClient = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
  });

  redisClient.on('error', (err) => {
    console.error('Redis client error:', err);
  });

  redisClient.on('connect', () => {
    console.log('✓ Redis client connected');
  });

  return redisClient;
}

export function createRedisPubSub(): { pub: Redis; sub: Redis } {
  if (redisPubClient && redisSubClient) {
    return { pub: redisPubClient, sub: redisSubClient };
  }

  redisPubClient = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
  redisSubClient = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

  redisPubClient.on('connect', () => {
    console.log('✓ Redis pub client connected');
  });

  redisSubClient.on('connect', () => {
    console.log('✓ Redis sub client connected');
  });

  return { pub: redisPubClient, sub: redisSubClient };
}

export async function closeRedis(): Promise<void> {
  if (redisClient) await redisClient.quit();
  if (redisPubClient) await redisPubClient.quit();
  if (redisSubClient) await redisSubClient.quit();
}
