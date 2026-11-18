import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AREAS, QUESTION_COUNT, cleanAnswers, summarize, answerLabel } from './quiz';

test('there is one grade question plus one per area', () => {
  assert.equal(QUESTION_COUNT, AREAS.length + 1);
  assert.equal(QUESTION_COUNT, 9);
});

test('unanswered areas count as gaps', () => {
  const s = summarize({});
  assert.equal(s.gapCount, 8);
  assert.equal(s.grade, null);
});

test('depth: "just joined in" is still a gap, "placed or won" is covered', () => {
  assert.equal(summarize({ depth: 'a1' }).statuses.depth, 'gap');
  assert.equal(summarize({ depth: 'a2' }).statuses.depth, 'partly');
  assert.equal(summarize({ depth: 'a3' }).statuses.depth, 'covered');
});

test('cleanAnswers drops unknown keys, bad option ids and trims text', () => {
  const out = cleanAnswers({ grade: '9', rigor: 'a9', hacker: 'x', depth: 'a2', depth_text: '  soccer and much much more text than forty chars  ', rigor_text: 'nope' });
  assert.deepEqual(Object.keys(out).sort(), ['depth', 'depth_text', 'grade']);
  assert.equal(out.depth_text.length, 40);
  assert.equal(summarize(out).grade, 9);
});

test('answerLabel includes the free text', () => {
  assert.equal(answerLabel('depth', { depth: 'a3', depth_text: 'chess' }), 'Placed or won (chess)');
  assert.equal(answerLabel('lead', {}), 'Skipped');
});
