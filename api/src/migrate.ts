import { getPool } from './db';
import { MIGRATIONS } from './migrations';

/** Applies pending migrations in order, each in its own transaction. Safe to run repeatedly. */
export async function migrate(log: (msg: string) => void = console.log): Promise<string[]> {
  const pool = await getPool();
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    // Serialize concurrent runs (e.g. two deploys) with an advisory lock.
    await client.query('SELECT pg_advisory_lock(727274)');
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const done = new Set((await client.query<{ id: string }>('SELECT id FROM schema_migrations')).rows.map(r => r.id));
    for (const m of MIGRATIONS) {
      if (done.has(m.id)) continue;
      await client.query('BEGIN');
      try {
        await client.query(m.sql);
        await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [m.id]);
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      }
      applied.push(m.id);
      log('applied ' + m.id);
    }
    if (!applied.length) log('database is up to date');
  } finally {
    await client.query('SELECT pg_advisory_unlock(727274)').catch(() => {});
    client.release();
  }
  return applied;
}

/** Lambda entry point, run by the CDK deploy trigger. */
export const handler = async () => ({ applied: await migrate() });
