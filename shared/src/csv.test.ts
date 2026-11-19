import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csvCell, csvDate, feedbackCsv, overviewCsv, sessionsCsv, toCsv } from './csv';
import { AREAS, QUESTIONS } from './quiz';

/** Minimal RFC 4180 parser, to check the files read back exactly. */
function parse(csv: string): string[][] {
  assert.ok(csv.startsWith('﻿'), 'starts with a byte-order mark');
  const s = csv.slice(1), rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\r' && s[i + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; }
    else cell += c;
  }
  return rows;
}

test('cells: quoting, blanks, and no spreadsheet formulas', () => {
  assert.equal(csvCell('plain'), 'plain');
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(0), '0');
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('two\nlines'), '"two\nlines"');
  assert.equal(csvCell('=HYPERLINK("http://x")'), `"'=HYPERLINK(""http://x"")"`);
  for (const f of ['+1', '-1', '@SUM(A1)']) assert.equal(csvCell(f), "'" + f);
  assert.equal(csvCell('—'), '—');
});

test('a file round-trips, including unicode and line breaks', () => {
  const rows = [['Maya O’Neil 🙂', 'line 1\r\nline 2, "quoted"']];
  assert.deepEqual(parse(toCsv(['Name', 'Note'], rows)), [['Name', 'Note'], ...rows]);
});

test('dates are local YYYY-MM-DD HH:MM', () => {
  const d = new Date(2026, 10, 9, 7, 5);
  assert.equal(csvDate(d.getTime()), '2026-11-09 07:05');
  assert.equal(csvDate(null), '');
});

test('sessions: one column per question and area result; unfinished rows have no results', () => {
  const t = new Date(2026, 10, 19, 19, 37).getTime();
  const done = { id: 's1', clientId: 'c', name: 'Maya', answers: { grade: '9', rigor: 'a2', depth: 'a1', depth_text: 'chess, "club"' }, pos: 9, createdAt: t, updatedAt: t, completedAt: t };
  const partial = { ...done, id: 's2', name: null, answers: { grade: '7' }, pos: 1, completedAt: null };
  const [header, a, b] = parse(sessionsCsv([done, partial]));
  const col = (row: string[], name: string) => row[header.indexOf(name)];
  const textQ = QUESTIONS.filter(q => q.text);
  assert.equal(header.length, 9 + (QUESTIONS.length - 1) + textQ.length + AREAS.length + 1);
  assert.equal(col(a, 'Name'), 'Maya');
  assert.equal(col(a, 'Grade'), '9');
  assert.equal(col(a, 'Started'), '2026-11-19 19:37');
  assert.equal(col(a, 'Progress'), 'Finished');
  assert.equal(col(a, AREAS[0].q), AREAS[0].opts[2]);
  assert.equal(col(a, 'Result: ' + AREAS[0].title), 'covered');
  const depth = AREAS.find(x => x.k === 'depth')!;
  assert.equal(col(a, depth.q + ' (their words)'), 'chess, "club"');
  assert.equal(col(a, 'Session ID'), 's1');
  assert.equal(col(b, 'Name'), '');
  assert.equal(col(b, 'Progress'), 'Question 2 of 9');
  assert.equal(col(b, 'Gaps'), '');
  assert.equal(col(b, 'Result: ' + AREAS[0].title), '');

  const [anonHeader, anon] = parse(sessionsCsv([done], { names: false }));
  assert.ok(!anonHeader.includes('Name'), 'no Name column');
  assert.ok(!anon.includes('Maya'), 'name not anywhere in the row');
  assert.equal(anonHeader.length, header.length - 1);
});

test('overview: counts by area for all grades and each grade with data; no personal data', () => {
  const t = Date.now();
  const s = (id: string, grade: string, rigor: string, done = true) =>
    ({ id, clientId: 'c', name: 'Secret Name', answers: { grade, rigor }, pos: done ? 9 : 2, createdAt: t, updatedAt: t, completedAt: done ? t : null });
  const sessions = [s('1', '7', 'a0'), s('2', '7', 'a2'), s('3', '10', 'a0'), s('4', '8', 'a0', false)];
  const fb = [{ id: 'f', clientId: 'c', sessionId: null, rating: 'Very helpful', useful: null, wrong: '', wish: '', createdAt: t }];
  const csv = overviewCsv(sessions, fb);
  assert.ok(!csv.includes('Secret Name'));
  const rows = parse(csv);
  assert.deepEqual(rows[0], ['Grade', 'Area', 'Finished quizzes', 'Gap', 'Partly', 'Covered', '% with a gap']);
  const rigor = AREAS[0].title;
  const find = (g: string) => rows.find(r => r[0] === g && r[1] === rigor);
  assert.deepEqual(find('All grades'), ['All grades', rigor, '3', '2', '0', '1', '67']);
  assert.deepEqual(find('7th'), ['7th', rigor, '2', '1', '0', '1', '50']);
  assert.deepEqual(find('10th'), ['10th', rigor, '1', '1', '0', '0', '100']);
  assert.equal(find('8th'), undefined, 'grade with only unfinished quizzes is left out');
  assert.equal(rows.filter(r => r[0] === 'All grades').length, AREAS.length);
  const value = (label: string) => rows.find(r => r[0] === label)?.[1];
  assert.equal(value('Quizzes started'), '4');
  assert.equal(value('Quizzes finished'), '3');
  assert.equal(value('Very helpful'), '1');
  assert.equal(value('Not really helpful'), '0');

  const empty = parse(overviewCsv([], []));
  assert.equal(empty.find(r => r[0] === 'All grades')?.[6], '', 'no divide by zero');
});

test('feedback', () => {
  const t = new Date(2026, 0, 2, 3, 4).getTime();
  const [fh, f] = parse(feedbackCsv([{ id: 'f', clientId: 'c', sessionId: null, rating: 'Very helpful', useful: 'depth', wrong: '', wish: 'more\ntips', createdAt: t }]));
  assert.deepEqual(fh, ['When', 'Rating', 'Most useful', 'Felt wrong', 'Wishes', 'Session ID']);
  assert.deepEqual(f, ['2026-01-02 03:04', 'Very helpful', AREAS.find(a => a.k === 'depth')!.title, '', 'more\ntips', '']);

});
