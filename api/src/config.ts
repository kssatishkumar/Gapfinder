// Database settings: DATABASE_URL locally, the RDS-generated secret (DB_SECRET_ARN) on AWS.
// Admin sign-in settings are read directly from env in auth.ts.
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

export interface Config {
  db: { host: string; port: number; user: string; password: string; database: string; ssl: boolean } | { connectionString: string; ssl: boolean };
}

let cached: Promise<Config> | undefined;

async function load(): Promise<Config> {
  const env = process.env;
  if (env.DB_SECRET_ARN) {
    const res = await new SecretsManagerClient({}).send(new GetSecretValueCommand({ SecretId: env.DB_SECRET_ARN }));
    const db = JSON.parse(res.SecretString ?? '{}');
    return { db: { host: db.host, port: Number(db.port), user: db.username, password: db.password, database: db.dbname, ssl: true } };
  }
  if (!env.DATABASE_URL) throw new Error('Missing env var DATABASE_URL (see api/.env.example)');
  return { db: { connectionString: env.DATABASE_URL, ssl: env.DATABASE_SSL === 'true' } };
}

export const getConfig = () => (cached ??= load());
