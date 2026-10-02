import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getPool, closePool } from './db.js';

function migrationsDir() {
  for (const p of [join(process.cwd(), 'migrations'), new URL('../migrations', import.meta.url).pathname, new URL('../../migrations', import.meta.url).pathname]) {
    if (existsSync(p)) return p;
  }
  throw new Error('No se encontró la carpeta migrations');
}

export async function migrate(log = true) {
  const pool = getPool();
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const done = new Set((await pool.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
  const dir = migrationsDir();
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = readFileSync(join(dir, f), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [f]);
      await client.query('COMMIT');
      if (log) console.log(`migración aplicada: ${f}`);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrate()
    .then(() => console.log('migraciones al día'))
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => closePool());
}
