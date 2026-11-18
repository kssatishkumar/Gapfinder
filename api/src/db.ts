import pg from 'pg';
import { getConfig } from './config';

let pool: pg.Pool | undefined;

export async function getPool(): Promise<pg.Pool> {
  if (pool) return pool;
  const { db } = await getConfig();
  const { ssl, ...conn } = db;
  pool = new pg.Pool({
    ...conn,
    // TLS is required, but the Amazon RDS CA isn't in Node's default store, so the certificate isn't verified.
    // Traffic stays inside the VPC. TODO: bundle the RDS CA (global-bundle.pem) and verify it.
    ssl: ssl ? { rejectUnauthorized: false } : undefined,
    max: process.env.AWS_LAMBDA_FUNCTION_NAME ? 2 : 10,
    idleTimeoutMillis: 30_000,
  });
  return pool;
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params: unknown[] = []) {
  const p = await getPool();
  return p.query<T>(text, params);
}

export async function closePool() {
  await pool?.end();
  pool = undefined;
}
