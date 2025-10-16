import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { getPool } from './pool';
import * as bcrypt from 'bcrypt';

async function runMigrations() {
  const pool = getPool();
  const client = await pool.connect();

  try {
    console.log('Running database migrations...');

    // Get all migration files
    const migrationsDir = join(__dirname, '../../database/migrations');
    const migrationFiles = readdirSync(migrationsDir)
      .filter(file => file.endsWith('.sql'))
      .sort(); // Ensure migrations run in order

    // Run each migration file
    for (const file of migrationFiles) {
      console.log(`Running migration: ${file}`);
      const sql = readFileSync(join(migrationsDir, file), 'utf-8');
      await client.query(sql);
      console.log(`✓ ${file} completed`);
    }

    // Seed admin user with credentials from environment
    const adminUsername = process.env.ADMIN_USERNAME || 'admin';
    const adminPassword = process.env.ADMIN_PASSWORD || 'changeme123';
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@university.edu';
    const passwordHash = await bcrypt.hash(adminPassword, 10);

    await client.query(
      `
      INSERT INTO users (email, username, password_hash, full_name, role, is_active)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (email) DO UPDATE
      SET password_hash = EXCLUDED.password_hash,
          username = EXCLUDED.username
      `,
      [adminEmail, adminUsername, passwordHash, 'System Administrator', 'admin', true]
    );
    console.log(`✓ Admin user seeded (${adminUsername})`);

    console.log('✓ Migrations complete');
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  runMigrations()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

export { runMigrations };
