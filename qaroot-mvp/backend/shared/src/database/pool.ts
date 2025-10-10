import { Pool, PoolConfig } from 'pg';

let pool: Pool | null = null;

export function createPool(config?: PoolConfig): Pool {
  if (pool) {
    return pool;
  }

  const poolConfig: PoolConfig = config || {
    connectionString: process.env.DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  };

  pool = new Pool(poolConfig);

  pool.on('error', (err) => {
    console.error('Unexpected error on idle client', err);
    process.exit(-1);
  });

  return pool;
}

export function getPool(): Pool {
  if (!pool) {
    return createPool();
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
