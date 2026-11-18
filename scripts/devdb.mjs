// Starts/stops a throwaway local PostgreSQL for development, stored in .local/pgdata (git-ignored).
// Needs the PostgreSQL binaries (initdb, pg_ctl, psql) on PATH. Uses port 5433.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const root = resolve(import.meta.dirname, '..');
const data = join(root, '.local', 'pgdata');
const log = join(root, '.local', 'pg.log');
const PORT = '5433';
const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit' });

const cmd = process.argv[2];
if (cmd === 'start') {
  if (!existsSync(join(data, 'PG_VERSION'))) {
    mkdirSync(join(root, '.local'), { recursive: true });
    const pw = join(tmpdir(), 'mbq-pgpass-' + process.pid);
    writeFileSync(pw, 'mbq\n');
    try {
      run('initdb', ['-D', data, '-U', 'mbq', '--pwfile=' + pw, '-A', 'scram-sha-256', '-E', 'UTF8', '--no-locale']);
    } finally {
      rmSync(pw, { force: true });
    }
  }
  const status = spawnSync('pg_ctl', ['status', '-D', data]);
  if (status.status !== 0) {
    // stdio 'ignore': the server process would otherwise inherit our stdout and keep the caller's pipe open forever.
    const r = spawnSync('pg_ctl', ['start', '-w', '-D', data, '-l', log, '-o', `-p ${PORT} -c listen_addresses=localhost`], { stdio: 'ignore' });
    if (r.status !== 0) throw new Error('pg_ctl start failed, see ' + log);
  }
  const env = { ...process.env, PGPASSWORD: 'mbq' };
  const has = spawnSync('psql', ['-h', 'localhost', '-p', PORT, '-U', 'mbq', '-d', 'postgres', '-tAc', "SELECT 1 FROM pg_database WHERE datname='mbq'"], { env, encoding: 'utf8' });
  if (has.stdout.trim() !== '1') execFileSync('psql', ['-h', 'localhost', '-p', PORT, '-U', 'mbq', '-d', 'postgres', '-c', 'CREATE DATABASE mbq'], { env, stdio: 'inherit' });
  console.log(`Postgres running: postgres://mbq:mbq@localhost:${PORT}/mbq`);
} else if (cmd === 'stop') {
  run('pg_ctl', ['stop', '-D', data, '-m', 'fast']);
} else {
  console.error('usage: node scripts/devdb.mjs start|stop');
  process.exit(1);
}
