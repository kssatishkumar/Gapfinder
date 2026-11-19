// Local stand-in for the AWS API (API Gateway → DynamoDB), for development only. Never deployed.
// Same routes, validation (the shared JSON schemas) and responses as the real API.
// Data is kept in .local/mock-db.json. Admin routes accept any X-Auth header, since the
// local admin page runs without Cognito (web/public/config.json says {"mode":"dev"}).
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv-draft-04';
import {
  sessionPutSchema, feedbackPostSchema, mentorRequestPostSchema, requestStatusSchema,
  type SessionRow, type FeedbackRow, type RequestRow, type SessionPut, type FeedbackPost, type MentorRequestPost,
} from '@mbq/shared';

interface Db { sessions: SessionRow[]; feedback: FeedbackRow[]; requests: RequestRow[] }

const ajv = new Ajv({ allErrors: true });
const validators = {
  session: ajv.compile(sessionPutSchema),
  feedback: ajv.compile(feedbackPostSchema),
  request: ajv.compile(mentorRequestPostSchema),
  status: ajv.compile(requestStatusSchema),
};

export function createMockApi(dbFile: string | null) {
  let db: Db = { sessions: [], feedback: [], requests: [] };
  if (dbFile && existsSync(dbFile)) db = JSON.parse(readFileSync(dbFile, 'utf8'));
  const persist = () => {
    if (!dbFile) return;
    mkdirSync(dirname(dbFile), { recursive: true });
    writeFileSync(dbFile, JSON.stringify(db, null, 2));
  };

  const send = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  async function readJson(req: IncomingMessage): Promise<unknown> {
    let raw = '';
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > 64 * 1024) throw new Error('too large');
    }
    return JSON.parse(raw || 'null');
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const path = (req.url ?? '').split('?')[0];
    const method = req.method ?? 'GET';
    const now = Date.now();

    const body = async (v: (typeof validators)[keyof typeof validators]) => {
      let b: unknown;
      try { b = await readJson(req); } catch { send(res, 400, { error: 'Invalid request', detail: 'Body is not JSON' }); return null; }
      if (!v(b)) { send(res, 400, { error: 'Invalid request', detail: ajv.errorsText(v.errors) }); return null; }
      return b;
    };

    if (method === 'PUT' && path === '/api/sessions') {
      const b = (await body(validators.session)) as SessionPut | null;
      if (!b) return;
      const existing = db.sessions.find(s => s.id === b.id);
      if (existing && existing.clientId !== b.clientId) return send(res, 403, { error: 'This session belongs to someone else' });
      const row: SessionRow = existing ?? { id: b.id, clientId: b.clientId, name: b.name, answers: {}, pos: 0, createdAt: now, updatedAt: now, completedAt: null };
      Object.assign(row, { name: b.name, answers: b.answers, pos: b.pos, updatedAt: now });
      if (b.completed && !row.completedAt) row.completedAt = now;
      if (!existing) db.sessions.push(row);
      persist();
      return send(res, 200, { ok: true });
    }

    if (method === 'POST' && path === '/api/feedback') {
      const b = (await body(validators.feedback)) as FeedbackPost | null;
      if (!b) return;
      const id = randomUUID();
      db.feedback.push({ id, ...b, createdAt: now });
      persist();
      return send(res, 201, { id });
    }

    if (method === 'POST' && path === '/api/mentor-requests') {
      const b = (await body(validators.request)) as MentorRequestPost | null;
      if (!b) return;
      const id = randomUUID();
      db.requests.push({ id, ...b, status: 'new', createdAt: now, updatedAt: now });
      persist();
      return send(res, 201, { id });
    }

    if (path.startsWith('/api/admin/')) {
      if (!req.headers['x-auth']) return send(res, 401, { error: 'Not signed in' });
      if (method === 'GET' && path === '/api/admin/sessions') return send(res, 200, db.sessions);
      if (method === 'GET' && path === '/api/admin/feedback') return send(res, 200, db.feedback);
      if (method === 'GET' && path === '/api/admin/requests') return send(res, 200, db.requests);
      const m = /^\/api\/admin\/requests\/([^/]+)$/.exec(path);
      if (method === 'PATCH' && m) {
        const b = (await body(validators.status)) as { status: string } | null;
        if (!b) return;
        const r = db.requests.find(x => x.id === decodeURIComponent(m[1]));
        if (!r) return send(res, 404, { error: 'Request not found' });
        Object.assign(r, { status: b.status, updatedAt: now });
        persist();
        return send(res, 200, { ok: true });
      }
    }

    return send(res, 404, { error: 'Not found' });
  }

  return createServer((req, res) => {
    handle(req, res).catch(e => { console.error(e); send(res, 500, { error: 'Something went wrong' }); });
  });
}

// Started directly (npm run dev:api): listen on :3001 and keep data in .local/mock-db.json.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dbFile = resolve(fileURLToPath(import.meta.url), '../../../.local/mock-db.json');
  const port = Number(process.env.PORT || 3001);
  createMockApi(dbFile).listen(port, '127.0.0.1', () => console.log(`Mock API on http://127.0.0.1:${port} (data: ${dbFile})`));
}
