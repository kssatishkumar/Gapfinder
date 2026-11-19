// Checks the mock behaves like the real API contract the web app relies on.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { createMockApi } from './server';

const server = createMockApi(null).listen(0);
const base = () => `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(() => server.close());

const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
  const res = await fetch(base() + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: await res.json() };
};
const clientId = randomUUID();
const id = randomUUID();
const admin = { 'x-auth': 'dev' };

test('session autosave, ownership, and validation', async () => {
  assert.equal((await call('PUT', '/api/sessions', { id, clientId, answers: { grade: '9' }, pos: 1, completed: false })).status, 200);
  assert.equal((await call('PUT', '/api/sessions', { id, clientId, answers: { grade: '9', rigor: 'a2' }, pos: 9, completed: true })).status, 200);
  assert.equal((await call('PUT', '/api/sessions', { id, clientId: randomUUID(), answers: {}, pos: 0, completed: false })).status, 403);
  const bad = await call('PUT', '/api/sessions', { id, clientId, answers: { rigor: 'a9' }, pos: 1, completed: false });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.error, 'Invalid request');
});

test('feedback and mentor requests are stored; admin needs X-Auth', async () => {
  assert.equal((await call('POST', '/api/feedback', { clientId, sessionId: id, rating: 'Very helpful', useful: null, wrong: '', wish: 'x' })).status, 201);
  const r = await call('POST', '/api/mentor-requests', { clientId, sessionId: id, mentorId: 'bell', grade: 9, message: 'Hi', parentEmail: 'p@example.com' });
  assert.equal(r.status, 201);

  assert.equal((await call('GET', '/api/admin/sessions')).status, 401);
  const sessions = await call('GET', '/api/admin/sessions', undefined, admin);
  assert.equal(sessions.json[0].pos, 9);
  assert.ok(sessions.json[0].completedAt);
  assert.equal((await call('GET', '/api/admin/feedback', undefined, admin)).json.length, 1);
  const reqs = (await call('GET', '/api/admin/requests', undefined, admin)).json;
  assert.equal(reqs[0].status, 'new');

  assert.equal((await call('PATCH', `/api/admin/requests/${reqs[0].id}`, { status: 'contacted' }, admin)).status, 200);
  assert.equal((await call('PATCH', `/api/admin/requests/${randomUUID()}`, { status: 'closed' }, admin)).status, 404);
  assert.equal((await call('PATCH', `/api/admin/requests/${reqs[0].id}`, { status: 'deleted' }, admin)).status, 400);
  assert.equal((await call('GET', '/api/nope')).status, 404);
});
