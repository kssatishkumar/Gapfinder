// Integration tests against the local dev database (npm run db:start && npm run db:migrate first).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { buildApp } from './app';
import { query, closePool } from './db';
import { defaultVerifier, parseGroups, type AdminIdentity } from './auth';

// Stand-in for Cognito: the bearer token names who is calling.
const PEOPLE: Record<string, AdminIdentity> = {
  admin: { sub: '1', email: 'admin@example.com', groups: ['admins'] },
  staff: { sub: '2', email: 'staff@example.com', groups: [] },
};
const fakeVerifier = async (req: FastifyRequest) => PEOPLE[(req.headers.authorization ?? '').replace('Bearer ', '')] ?? null;

const app = buildApp({ verifyAdmin: fakeVerifier });
const clientId = randomUUID();
const sessionId = randomUUID();

after(async () => {
  await query('DELETE FROM mentor_requests WHERE client_id = $1', [clientId]);
  await query('DELETE FROM feedback WHERE client_id = $1', [clientId]);
  await query('DELETE FROM quiz_sessions WHERE client_id = $1', [clientId]);
  await app.close();
  await closePool();
});

const put = (id: string, body: object) => app.inject({ method: 'PUT', url: '/api/sessions/' + id, payload: body });

test('health and mentors', async () => {
  assert.equal((await app.inject('/api/health')).statusCode, 200);
  const res = await app.inject('/api/mentors');
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().length, 10);
});

test('session autosave: create, update, complete, scored on the server', async () => {
  let res = await put(sessionId, { clientId, answers: { grade: '10', rigor: 'a2' }, pos: 2, completed: false });
  assert.equal(res.statusCode, 200);
  res = await put(sessionId, { clientId, answers: { grade: '10', rigor: 'a2', depth: 'a3', depth_text: 'chess', evil: 'x' }, pos: 9, completed: true });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().summary.coveredCount, 2);
  const { rows } = await query('SELECT grade, answers, completed_at FROM quiz_sessions WHERE id = $1', [sessionId]);
  assert.equal(rows[0].grade, 10);
  assert.equal(rows[0].answers.evil, undefined);
  assert.ok(rows[0].completed_at);
});

test('another client cannot overwrite a session', async () => {
  const res = await put(sessionId, { clientId: randomUUID(), answers: {}, pos: 0, completed: false });
  assert.equal(res.statusCode, 403);
});

test('bad input is rejected with 400', async () => {
  assert.equal((await put('not-a-uuid', { clientId, answers: {}, pos: 0, completed: false })).statusCode, 400);
  assert.equal((await put(randomUUID(), { clientId, answers: 'nope', pos: 0, completed: false })).statusCode, 400);
});

test('feedback links to the session only for its owner', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/feedback', payload: { clientId, sessionId, rating: 'Very helpful', useful: 'depth', wrong: '', wish: ' more tips ' } });
  assert.equal(res.statusCode, 201);
  const { rows } = await query('SELECT session_id, wish, answers FROM feedback WHERE id = $1', [res.json().id]);
  assert.equal(rows[0].session_id, sessionId);
  assert.equal(rows[0].wish, 'more tips');
  assert.equal(rows[0].answers.depth_text, 'chess');

  const other = await app.inject({ method: 'POST', url: '/api/feedback', payload: { clientId: randomUUID(), sessionId, rating: 'Very helpful', useful: null, wrong: '', wish: '' } });
  const o = await query('SELECT session_id, client_id FROM feedback WHERE id = $1', [other.json().id]);
  assert.equal(o.rows[0].session_id, null);
  await query('DELETE FROM feedback WHERE id = $1', [other.json().id]);
});

test('mentor request needs a valid parent email and a real mentor', async () => {
  const base = { clientId, sessionId, mentorId: 'bell', grade: 8, message: 'Hi Marcus' };
  assert.equal((await app.inject({ method: 'POST', url: '/api/mentor-requests', payload: { ...base, parentEmail: 'nope' } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url: '/api/mentor-requests', payload: { ...base, mentorId: 'ghost', parentEmail: 'p@example.com' } })).statusCode, 404);
  const ok = await app.inject({ method: 'POST', url: '/api/mentor-requests', payload: { ...base, parentEmail: ' Parent@Example.com ' } });
  assert.equal(ok.statusCode, 201);
  const { rows } = await query('SELECT parent_email, status FROM mentor_requests WHERE id = $1', [ok.json().id]);
  assert.deepEqual(rows[0], { parent_email: 'parent@example.com', status: 'new' });
});

test('admin routes: 401 when signed out, 403 outside the admins group', async () => {
  assert.equal((await app.inject('/api/admin/summary')).statusCode, 401);
  assert.equal((await app.inject({ url: '/api/admin/summary', headers: { authorization: 'Bearer nobody' } })).statusCode, 401);
  assert.equal((await app.inject({ url: '/api/admin/summary', headers: { authorization: 'Bearer staff' } })).statusCode, 403);
  assert.equal((await app.inject({ method: 'PATCH', url: '/api/admin/requests/' + randomUUID(), headers: { authorization: 'Bearer staff' }, payload: { status: 'closed' } })).statusCode, 403);
});

test('admin routes work for an admin', async () => {
  const auth = { authorization: 'Bearer admin' };
  assert.deepEqual((await app.inject({ url: '/api/admin/me', headers: auth })).json(), { email: 'admin@example.com' });
  const sum = await app.inject({ url: '/api/admin/summary', headers: auth });
  assert.equal(sum.statusCode, 200);
  assert.ok(sum.json().sessions.completed >= 1);
  const reqs = (await app.inject({ url: '/api/admin/requests', headers: auth })).json();
  const mine = reqs.find((r: { message: string }) => r.message === 'Hi Marcus');
  const patch = await app.inject({ method: 'PATCH', url: '/api/admin/requests/' + mine.id, headers: auth, payload: { status: 'contacted' } });
  assert.equal(patch.statusCode, 200);
});

test('parseGroups reads API Gateway and plain array formats', () => {
  assert.deepEqual(parseGroups('[admins editors]'), ['admins', 'editors']);
  assert.deepEqual(parseGroups(['admins']), ['admins']);
  assert.deepEqual(parseGroups(undefined), []);
});

test('in Lambda: trusts only authorizer claims for this app client, never the dev bypass', async () => {
  const saved = { ...process.env };
  try {
    Object.assign(process.env, { AWS_LAMBDA_FUNCTION_NAME: 'test', COGNITO_CLIENT_ID: 'client-1', ADMIN_DEV_BYPASS: 'true' });
    const req = (claims?: Record<string, unknown>) =>
      ({ headers: {}, awsLambda: { event: { requestContext: { authorizer: claims ? { jwt: { claims } } : undefined } } } }) as unknown as FastifyRequest;
    assert.equal(await defaultVerifier(req()), null, 'no claims, and the bypass must not apply in Lambda');
    assert.equal(await defaultVerifier(req({ sub: 'x', token_use: 'access', client_id: 'other' })), null, 'token for another app client');
    assert.equal(await defaultVerifier(req({ sub: 'x', token_use: 'id', client_id: 'client-1' })), null, 'id token instead of access token');
    const ok = await defaultVerifier(req({ sub: 'x', token_use: 'access', client_id: 'client-1', username: 'u1', 'cognito:groups': '[admins]' }));
    assert.deepEqual(ok, { sub: 'x', email: 'u1', groups: ['admins'] });
  } finally {
    process.env = saved;
  }
});
