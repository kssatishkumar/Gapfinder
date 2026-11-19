import { test } from 'node:test';
import assert from 'node:assert/strict';
import Ajv from 'ajv-draft-04';
import { sessionPutSchema, feedbackPostSchema, mentorRequestPostSchema, requestStatusSchema } from './schemas';

const ajv = new Ajv({ allErrors: true });
const check = (schema: object) => { const v = ajv.compile(schema); return (body: unknown) => v(body); };
const session = check(sessionPutSchema);
const feedback = check(feedbackPostSchema);
const mentor = check(mentorRequestPostSchema);
const status = check(requestStatusSchema);

const id = '3f2b8c1e-5a6d-4e7f-8a9b-0c1d2e3f4a5b';
const clientId = '11111111-2222-4333-8444-555555555555';

test('session: accepts real answers, rejects unknown questions, options and long text', () => {
  const ok = { id, clientId, name: 'Maya', answers: { grade: '9', depth: 'a3', depth_text: 'chess' }, pos: 9, completed: true };
  assert.ok(session(ok));
  assert.ok(!session({ ...ok, answers: { hacker: 'x' } }), 'unknown question');
  assert.ok(!session({ ...ok, answers: { rigor: 'a9' } }), 'unknown option');
  assert.ok(!session({ ...ok, answers: { rigor_text: 'no text box on this question' } }), 'text on a question without a text box');
  assert.ok(!session({ ...ok, answers: { depth_text: 'x'.repeat(41) } }), 'text over 40 chars');
  assert.ok(!session({ ...ok, id: 'not-a-uuid' }));
  const { name: _n, ...noName } = ok;
  assert.ok(!session(noName), 'name is required');
  assert.ok(!session({ ...ok, name: '   ' }), 'blank name');
  assert.ok(!session({ ...ok, name: 'x'.repeat(61) }), 'name over 60 chars');
  assert.ok(!session({ ...ok, pos: 10 }));
  assert.ok(!session({ ...ok, extra: 1 }), 'extra field');
});

test('feedback: rating required, useful must be an area or null', () => {
  const ok = { clientId, sessionId: id, rating: 'Very helpful', useful: 'depth', wrong: '', wish: 'more' };
  assert.ok(feedback(ok));
  assert.ok(feedback({ ...ok, sessionId: null, useful: null }));
  assert.ok(!feedback({ ...ok, rating: 'Amazing' }));
  assert.ok(!feedback({ ...ok, useful: 'nope' }));
  assert.ok(!feedback({ ...ok, wish: 'x'.repeat(2001) }));
});

test('mentor request: real mentor, email-like address, non-blank message', () => {
  const ok = { clientId, sessionId: null, mentorId: 'bell', grade: 8, message: 'Hi', parentEmail: 'p@example.com' };
  assert.ok(mentor(ok));
  assert.ok(mentor({ ...ok, grade: null }));
  assert.ok(!mentor({ ...ok, mentorId: 'ghost' }));
  assert.ok(!mentor({ ...ok, parentEmail: 'nope' }));
  assert.ok(!mentor({ ...ok, message: '   ' }));
  assert.ok(!mentor({ ...ok, grade: 13 }));
});

test('request status is one of new / contacted / closed', () => {
  assert.ok(status({ status: 'contacted' }));
  assert.ok(!status({ status: 'deleted' }));
});
