// Integration tests against the local dev database (npm run db:start && npm run db:migrate first).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildApp } from './app';
import { query, closePool } from './db';

const app = buildApp();
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
  let res = await put(sessionId, { clientId, variant: 'B', answers: { grade: '10', rigor: 'a2' }, pos: 2, completed: false });
  assert.equal(res.statusCode, 200);
  res = await put(sessionId, { clientId, variant: 'B', answers: { grade: '10', rigor: 'a2', depth: 'a3', depth_text: 'chess', evil: 'x' }, pos: 9, completed: true });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().summary.coveredCount, 2);
  const { rows } = await query('SELECT grade, answers, completed_at FROM quiz_sessions WHERE id = $1', [sessionId]);
  assert.equal(rows[0].grade, 10);
  assert.equal(rows[0].answers.evil, undefined);
  assert.ok(rows[0].completed_at);
});

test('another client cannot overwrite a session', async () => {
  const res = await put(sessionId, { clientId: randomUUID(), variant: 'A', answers: {}, pos: 0, completed: false });
  assert.equal(res.statusCode, 403);
});

test('bad input is rejected with 400', async () => {
  assert.equal((await put('not-a-uuid', { clientId, variant: 'A', answers: {}, pos: 0, completed: false })).statusCode, 400);
  assert.equal((await put(randomUUID(), { clientId, variant: 'C', answers: {}, pos: 0, completed: false })).statusCode, 400);
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

test('admin routes need a token', async () => {
  assert.equal((await app.inject('/api/admin/summary')).statusCode, 401);
  assert.equal((await app.inject({ method: 'POST', url: '/api/admin/login', payload: { password: 'wrong' } })).statusCode, 401);
  const login = await app.inject({ method: 'POST', url: '/api/admin/login', payload: { password: process.env.ADMIN_PASSWORD } });
  assert.equal(login.statusCode, 200);
  const auth = { authorization: 'Bearer ' + login.json().token };
  const sum = await app.inject({ url: '/api/admin/summary', headers: auth });
  assert.equal(sum.statusCode, 200);
  assert.ok(sum.json().sessions.completed >= 1);
  const reqs = (await app.inject({ url: '/api/admin/requests', headers: auth })).json();
  const mine = reqs.find((r: { message: string }) => r.message === 'Hi Marcus');
  const patch = await app.inject({ method: 'PATCH', url: '/api/admin/requests/' + mine.id, headers: auth, payload: { status: 'contacted' } });
  assert.equal(patch.statusCode, 200);
});
