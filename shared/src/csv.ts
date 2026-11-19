// CSV exports for the admin page. Built in the browser from the rows the admin API already returns.
// Output opens cleanly in Excel and Google Sheets: UTF-8 with a byte-order mark, CRLF line endings,
// RFC 4180 quoting, and "local" dates as YYYY-MM-DD HH:MM.
import { AREAS, GRADES, QUESTIONS, QUESTION_COUNT, summarize } from './quiz';
import { RATINGS } from './constants';
import type { FeedbackRow, SessionRow } from './schemas';

type Cell = string | number | null | undefined;

/** One CSV cell. Text that a spreadsheet would run as a formula (=, +, -, @) gets a leading ' so it stays text:
 *  names, messages and emails are typed by the public. */
export function csvCell(v: Cell): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return String(v);
  const s = /^[=+\-@\t\r]/.test(v) ? "'" + v : v;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** A whole CSV file, starting with a byte-order mark so Excel reads it as UTF-8. */
export function toCsv(header: string[], rows: Cell[][]): string {
  return '﻿' + [header, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

const pad = (n: number) => String(n).padStart(2, '0');
/** Local date and time as YYYY-MM-DD HH:MM, which spreadsheets recognise as a date. */
export function csvDate(ms: number | null): string {
  if (!ms) return '';
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const areaTitle = (k: string | null) => AREAS.find(a => a.k === k)?.title ?? '';

/** Quiz sessions: one row per student, with each answer as text and each area's result.
 *  With names: false the Name column is left out, for sharing the data outside the team. */
export function sessionsCsv(rows: SessionRow[], { names = true } = {}): string {
  const questions = QUESTIONS.filter(q => q.id !== 'grade');
  const header = [
    'Started', 'Last saved', 'Finished', ...(names ? ['Name'] : []), 'Grade', 'Progress', 'Gaps', 'Partly', 'Covered',
    ...questions.flatMap(q => [q.title, ...(q.text ? [q.title + ' (their words)'] : [])]),
    ...AREAS.map(a => 'Result: ' + a.title),
    'Session ID',
  ];
  const body = rows.map(s => {
    const sum = summarize(s.answers);
    const done = !!s.completedAt;
    return [
      csvDate(s.createdAt), csvDate(s.updatedAt), csvDate(s.completedAt), ...(names ? [s.name] : []), sum.grade,
      done ? 'Finished' : `Question ${Math.min(s.pos + 1, QUESTION_COUNT)} of ${QUESTION_COUNT}`,
      done ? sum.gapCount : null, done ? sum.partlyCount : null, done ? sum.coveredCount : null,
      ...questions.flatMap(q => [q.options.find(o => o.id === s.answers[q.id])?.label ?? '', ...(q.text ? [s.answers[q.id + '_text'] ?? ''] : [])]),
      ...AREAS.map(a => (done ? sum.statuses[a.k] : '')),
      s.id,
    ];
  });
  return toCsv(header, body);
}

export function feedbackCsv(rows: FeedbackRow[]): string {
  return toCsv(
    ['When', 'Rating', 'Most useful', 'Felt wrong', 'Wishes', 'Session ID'],
    rows.map(f => [csvDate(f.createdAt), f.rating, areaTitle(f.useful), f.wrong, f.wish, f.sessionId]),
  );
}

/** Overview: totals only, no personal data. Finished quizzes by area, for all grades and then each grade,
 *  followed by the headline numbers and the feedback ratings. Separate tables are split by a blank line. */
export function overviewCsv(sessions: SessionRow[], feedback: FeedbackRow[]): string {
  const finished = sessions.filter(s => s.completedAt).map(s => summarize(s.answers));
  const groups: [string, typeof finished][] = [
    ['All grades', finished],
    ...GRADES.map(g => [g + 'th', finished.filter(f => f.grade === g)] as [string, typeof finished]),
    ['Grade not given', finished.filter(f => f.grade === null)],
  ];
  const areaRows = groups.filter(([, fs], i) => i === 0 || fs.length).flatMap(([label, fs]) => AREAS.map(a => {
    const n = { gap: 0, partly: 0, covered: 0 };
    for (const f of fs) n[f.statuses[a.k]]++;
    return [label, a.title, fs.length, n.gap, n.partly, n.covered, fs.length ? Math.round(n.gap / fs.length * 100) : null];
  }));
  const ratings = RATINGS.map(r => [r, feedback.filter(f => f.rating === r).length]);
  return toCsv(['Grade', 'Area', 'Finished quizzes', 'Gap', 'Partly', 'Covered', '% with a gap'], [
    ...areaRows,
    [],
    ['Total', 'Count'],
    ['Quizzes started', sessions.length],
    ['Quizzes finished', finished.length],
    ['Feedback forms', feedback.length],
    [],
    ['Feedback rating', 'Count'],
    ...ratings,
  ]);
}
