// Settings come from env vars locally, and from Secrets Manager on AWS:
// DB_SECRET_ARN = the RDS-generated secret, ADMIN_SECRET_ARN = {adminPassword}, APP_SECRET_ARN = {jwtSecret}.
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

export interface Config {
  db: { host: string; port: number; user: string; password: string; database: string; ssl: boolean } | { connectionString: string; ssl: boolean };
  adminPassword: string;
  jwtSecret: string;
}

let cached: Promise<Config> | undefined;

async function readSecret(arn: string): Promise<Record<string, string>> {
  const sm = new SecretsManagerClient({});
  const res = await sm.send(new GetSecretValueCommand({ SecretId: arn }));
  return JSON.parse(res.SecretString ?? '{}');
}

async function load(): Promise<Config> {
  const env = process.env;
  if (env.DB_SECRET_ARN) {
    const [db, admin, app] = await Promise.all([
      readSecret(env.DB_SECRET_ARN),
      env.ADMIN_SECRET_ARN ? readSecret(env.ADMIN_SECRET_ARN) : Promise.resolve({} as Record<string, string>),
      env.APP_SECRET_ARN ? readSecret(env.APP_SECRET_ARN) : Promise.resolve({} as Record<string, string>),
    ]);
    return {
      db: { host: db.host, port: Number(db.port), user: db.username, password: db.password, database: db.dbname, ssl: true },
      // The migration Lambda only needs the database, so these may be absent there.
      adminPassword: admin.adminPassword ?? '',
      jwtSecret: app.jwtSecret ?? '',
    };
  }
  const missing = ['DATABASE_URL', 'ADMIN_PASSWORD', 'JWT_SECRET'].filter(k => !env[k]);
  if (missing.length) throw new Error('Missing env vars: ' + missing.join(', ') + ' (see api/.env.example)');
  if (env.JWT_SECRET!.length < 32) throw new Error('JWT_SECRET must be at least 32 characters');
  return {
    db: { connectionString: env.DATABASE_URL!, ssl: env.DATABASE_SSL === 'true' },
    adminPassword: env.ADMIN_PASSWORD!,
    jwtSecret: env.JWT_SECRET!,
  };
}

export const getConfig = () => (cached ??= load());
