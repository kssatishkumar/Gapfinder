// Renders the API Gateway mapping templates with a Velocity engine and a mock of API Gateway's
// $input / $util / $context, then checks the DynamoDB requests and the API responses are valid JSON
// and that text survives the round trip unchanged (quotes, apostrophes, newlines, unicode, VTL syntax).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import velocity from 'velocityjs';
import * as T from '../lib/templates';

// Java's String.contains, used by the error templates.
(String.prototype as unknown as { contains: (s: string) => boolean }).contains = function (this: string, s: string) { return this.includes(s); };

/** API Gateway's $util.escapeJavaScript (Apache StringEscapeUtils.escapeJavaScript). */
function escapeJavaScript(s: unknown): string {
  return String(s ?? '').replace(/[\\"'/\u0000-\u001f\u007f-￿]/g, c => {
    const map: Record<string, string> = { '\\': '\\\\', '"': '\\"', "'": "\\'", '/': '\\/', '\b': '\\b', '\f': '\\f', '\n': '\\n', '\r': '\\r', '\t': '\\t' };
    return map[c] ?? '\\u' + c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0');
  });
}
/** Wraps a string so .replaceAll(javaRegex, replacement) behaves like Java's (pattern is a regex). */
const javaString = (s: string) => ({ toString: () => s, replaceAll: (re: string, rep: string) => javaString(s.replace(new RegExp(re, 'g'), rep)) });

const jsonPath = (obj: unknown, path: string) => path.replace(/^\$\.?/, '').split('.').filter(Boolean).reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], obj);
/** Like API Gateway, $input.path hands JSON nulls to the template as empty strings, and API Gateway's
 *  #if treats an empty string as true. velocityjs treats '' as false, so use a truthy value that prints as ''. */
const AWS_EMPTY = { toString: () => '' };
const nullsAsEmpty = (v: unknown): unknown =>
  v === null ? AWS_EMPTY : Array.isArray(v) ? v.map(nullsAsEmpty) : typeof v === 'object' && v ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, nullsAsEmpty(x)])) : v;

function render(template: string, body: unknown, extra: { params?: Record<string, string> } = {}) {
  const context = { requestId: 'req-123', requestTimeEpoch: 1795000000000, responseOverride: { status: undefined as number | undefined } };
  const out = velocity.render(template, {
    input: {
      path: (p: string) => nullsAsEmpty(jsonPath(body, p)),
      json: (p: string) => JSON.stringify(jsonPath(body, p)),
      params: (name: string) => extra.params?.[name] ?? '',
    },
    util: { escapeJavaScript: (s: unknown) => javaString(escapeJavaScript(s)) },
    context,
  });
  return { text: out, json: () => JSON.parse(out), status: context.responseOverride.status };
}

/** Turns a DynamoDB request's attribute map into what Scan would return later. */
const asStored = (item: Record<string, Record<string, string>>) => item;

const NASTY = `He said "hi" & it's \\fine\\ — <b>ok</b>\nline 2\ttab 🙂 $util #set($x = 1) ${'{'}'}`;
const ids = { s: '3f2b8c1e-5a6d-4e7f-8a9b-0c1d2e3f4a5b', c: '11111111-2222-4333-8444-555555555555' };

test('session PUT → UpdateItem with ownership condition; answers round-trip through a scan', () => {
  const body = { id: ids.s, clientId: ids.c, name: NASTY, answers: { grade: '9', depth: 'a3', depth_text: `it's "chess"` }, pos: 9, completed: true };
  const req = render(T.sessionPutRequest('Sessions'), body).json();
  assert.equal(req.TableName, 'Sessions');
  assert.deepEqual(req.Key, { id: { S: ids.s } });
  assert.match(req.UpdateExpression, /completedAt = if_not_exists\(completedAt, :t\)/);
  assert.equal(req.ConditionExpression, 'attribute_not_exists(id) OR clientId = :c');
  assert.equal(req.ExpressionAttributeValues[':p'].N, '9');
  assert.equal(req.ExpressionAttributeValues[':n'].S, NASTY);
  assert.deepEqual(req.ExpressionAttributeNames, { '#n': 'name' }, 'name is a DynamoDB reserved word');
  assert.match(req.UpdateExpression, /#n = :n/);
  assert.deepEqual(JSON.parse(req.ExpressionAttributeValues[':a'].S), body.answers, 'answers stored as exact JSON');

  const notDone = render(T.sessionPutRequest('Sessions'), { ...body, completed: false, pos: 3 }).json();
  assert.doesNotMatch(notDone.UpdateExpression, /completedAt/);

  const stored = { id: { S: ids.s }, clientId: { S: ids.c }, name: { S: NASTY }, answers: { S: req.ExpressionAttributeValues[':a'].S }, pos: { N: '9' }, createdAt: { N: '1' }, updatedAt: { N: '2' }, completedAt: { N: '2' } };
  const inProgress = { id: { S: 'x' }, clientId: { S: ids.c }, answers: { S: '{}' }, pos: { N: '0' }, createdAt: { N: '1' }, updatedAt: { N: '1' } };
  const rows = render(T.sessionsScanResponse, { Items: [stored, inProgress] }).json();
  assert.deepEqual(rows[0], { id: ids.s, clientId: ids.c, name: NASTY, answers: body.answers, pos: 9, createdAt: 1, updatedAt: 2, completedAt: 2 });
  assert.equal(rows[1].completedAt, null);
  assert.equal(rows[1].name, null, 'sessions saved before names were asked');
  assert.deepEqual(render(T.sessionsScanResponse, { Items: [] }).json(), []);
});

test('session PUT errors: failed ownership condition → 403, other 400s stay 400', () => {
  const owned = render(T.sessionPutClientError, { __type: 'com.amazonaws.dynamodb.v20120810#ConditionalCheckFailedException' });
  assert.equal(owned.status, 403);
  assert.equal(owned.json().error, 'This session belongs to someone else');
  const other = render(T.sessionPutClientError, { __type: 'com.amazonaws.dynamodb.v20120810#ValidationException' });
  assert.equal(other.status, undefined);
  assert.equal(other.json().error, 'Invalid request');
});

test('feedback POST → PutItem; nasty text survives write and read', () => {
  const body = { clientId: ids.c, sessionId: ids.s, rating: 'Very helpful', useful: 'depth', wrong: NASTY, wish: '' };
  const req = render(T.feedbackPostRequest('Feedback'), body).json();
  assert.equal(req.Item.id.S, 'req-123');
  assert.equal(req.Item.wrong.S, NASTY);
  assert.equal(req.Item.wish.S, '');
  assert.equal(req.Item.createdAt.N, '1795000000000');

  const noSession = render(T.feedbackPostRequest('Feedback'), { ...body, sessionId: null, useful: null }).json();
  assert.equal(noSession.Item.sessionId, undefined);
  assert.equal(noSession.Item.useful, undefined);

  const rows = render(T.feedbackScanResponse, { Items: [asStored(req.Item), asStored(noSession.Item)] }).json();
  assert.equal(rows[0].wrong, NASTY);
  assert.equal(rows[0].sessionId, ids.s);
  assert.equal(rows[1].sessionId, null);
  assert.equal(rows[1].useful, null);
  assert.equal(rows[0].createdAt, 1795000000000);
  assert.deepEqual(render(T.createdResponse, {}).json(), { id: 'req-123' });
});

test('mentor request POST → PutItem with status "new"; message and email round-trip', () => {
  const body = { clientId: ids.c, sessionId: null, mentorId: 'bell', grade: 8, message: NASTY, parentEmail: "o'brien@example.com" };
  const req = render(T.mentorRequestPostRequest('Requests'), body).json();
  assert.equal(req.Item.status.S, 'new');
  assert.equal(req.Item.grade.N, '8');
  assert.equal(req.Item.message.S, NASTY);
  assert.equal(req.Item.parentEmail.S, "o'brien@example.com");
  assert.equal(req.Item.sessionId, undefined);

  const noGrade = render(T.mentorRequestPostRequest('Requests'), { ...body, grade: null }).json();
  assert.equal(noGrade.Item.grade, undefined);

  const rows = render(T.requestsScanResponse, { Items: [req.Item, noGrade.Item] }).json();
  assert.equal(rows[0].message, NASTY);
  assert.equal(rows[0].parentEmail, "o'brien@example.com");
  assert.equal(rows[0].grade, 8);
  assert.equal(rows[1].grade, null);
  assert.equal(rows[0].status, 'new');
});

test('request status PATCH → conditional UpdateItem; missing request → 404', () => {
  const req = render(T.requestStatusRequest('Requests'), { status: 'contacted' }, { params: { id: 'req-123' } }).json();
  assert.deepEqual(req.Key, { id: { S: 'req-123' } });
  assert.equal(req.ExpressionAttributeValues[':s'].S, 'contacted');
  assert.equal(req.ConditionExpression, 'attribute_exists(id)');
  // A crafted path id can't break out of the JSON string.
  const evil = render(T.requestStatusRequest('Requests'), { status: 'closed' }, { params: { id: `x"}, "TableName": "Other` } }).json();
  assert.equal(evil.TableName, 'Requests');
  assert.equal(evil.Key.id.S, `x"}, "TableName": "Other`);

  const missing = render(T.requestStatusClientError, { __type: 'x#ConditionalCheckFailedException' });
  assert.equal(missing.status, 404);
  assert.equal(missing.json().error, 'Request not found');
});

test('scan requests and fixed responses are valid JSON', () => {
  assert.deepEqual(render(T.scanRequest('Sessions'), {}).json(), { TableName: 'Sessions' });
  for (const t of [T.sessionPutOk, T.requestStatusOk, T.serverError]) assert.doesNotThrow(() => JSON.parse(t));
});
