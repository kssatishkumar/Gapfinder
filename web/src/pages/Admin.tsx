import { useCallback, useEffect, useMemo, useState } from 'react';
import { AREAS, MENTOR_SEED, QUESTION_COUNT, REQUEST_STATUSES, summarize, sessionsCsv, feedbackCsv, overviewCsv, csvDate, type SessionRow, type FeedbackRow, type RequestRow } from '@mbq/shared';
import { api, ApiError } from '../lib/api';
import { completeSignIn, currentToken, fetchAuthConfig, forgetToken, signIn, signOut, type AuthConfig } from '../lib/auth';

const areaTitle = (k: string | null) => AREAS.find(a => a.k === k)?.title ?? '—';
const mentorName = (id: string) => MENTOR_SEED.find(m => m.id === id)?.name ?? id;
const when = (ms: number | null) => (ms ? new Date(ms).toLocaleString() : '—');
const newestFirst = <T extends { createdAt: number }>(rows: T[]) => [...rows].sort((a, b) => b.createdAt - a.createdAt);

interface Data { sessions: SessionRow[]; feedback: FeedbackRow[]; requests: RequestRow[] }

type View =
  | { s: 'loading' }
  | { s: 'error'; msg: string }
  | { s: 'signedOut'; cfg: AuthConfig; msg?: string }
  | { s: 'in'; cfg: AuthConfig; token: string; email: string | null; data: Data };

const TABS = ['Overview', 'Mentor requests', 'Feedback', 'Quiz sessions'] as const;
type Tab = (typeof TABS)[number];

interface Export { label: string; file: string; csv: (d: Data) => string; empty: (d: Data) => boolean }
/** CSV downloads offered on each tab. Mentor requests has none: they hold parents' emails, which stay behind the sign-in. */
const EXPORTS: Partial<Record<Tab, Export[]>> = {
  Overview: [{ label: 'Download CSV', file: 'overview', csv: d => overviewCsv(d.sessions, d.feedback), empty: () => false }],
  Feedback: [{ label: 'Download CSV', file: 'feedback', csv: d => feedbackCsv(d.feedback), empty: d => !d.feedback.length }],
  'Quiz sessions': [
    { label: 'Download CSV', file: 'quiz-sessions', csv: d => sessionsCsv(d.sessions), empty: d => !d.sessions.length },
    { label: 'Download without names', file: 'quiz-sessions-no-names', csv: d => sessionsCsv(d.sessions, { names: false }), empty: d => !d.sessions.length },
  ],
};

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function loadData(token: string): Promise<Data> {
  const [sessions, feedback, requests] = await Promise.all([api.admin.sessions(token), api.admin.feedback(token), api.admin.requests(token)]);
  return { sessions: newestFirst(sessions), feedback: newestFirst(feedback), requests: newestFirst(requests) };
}

export function Admin() {
  const [view, setView] = useState<View>({ s: 'loading' });

  // Loading the data doubles as the sign-in check: API Gateway answers 401 for a missing or expired token.
  const refresh = useCallback(async (cfg: AuthConfig, msg?: string) => {
    const cur = currentToken(cfg);
    if (!cur) return setView({ s: 'signedOut', cfg, msg });
    try {
      setView({ s: 'in', cfg, token: cur.token, email: cur.email, data: await loadData(cur.token) });
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) { forgetToken(); return setView({ s: 'signedOut', cfg, msg: 'Your session ended. Sign in again.' }); }
      setView({ s: 'error', msg: 'Couldn’t reach the server. Refresh to try again.' });
    }
  }, []);

  useEffect(() => {
    (async () => {
      let cfg: AuthConfig;
      try { cfg = await fetchAuthConfig(); } catch { return setView({ s: 'error', msg: 'Couldn’t load the sign-in settings. Refresh to try again.' }); }
      let msg: string | undefined;
      try { await completeSignIn(cfg); } catch (e) { msg = (e as Error).message; }
      await refresh(cfg, msg);
    })();
  }, [refresh]);

  return (
    <main className="wrap page gap-22">
      <div className="row gap-10">
        <h1 className="h-page">Admin</h1>
        {view.s === 'in' && (
          <div className="row gap-10 ml-auto">
            {view.email && <span className="small muted">{view.email}</span>}
            <button className="btn btn-ghost" onClick={() => refresh(view.cfg)}>Refresh</button>
            {view.cfg.mode === 'cognito' && <button className="btn btn-ghost" onClick={() => signOut(view.cfg)}>Sign out</button>}
          </div>
        )}
      </div>
      {view.s === 'loading' && <p className="muted">Loading…</p>}
      {view.s === 'error' && <p className="error" role="alert">{view.msg}</p>}
      {view.s === 'signedOut' && <SignIn cfg={view.cfg} msg={view.msg} />}
      {view.s === 'in' && <Dashboard token={view.token} data={view.data} onChanged={() => refresh(view.cfg)} />}
    </main>
  );
}

function SignIn({ cfg, msg }: { cfg: AuthConfig; msg?: string }) {
  const [busy, setBusy] = useState(false);
  if (cfg.mode !== 'cognito') {
    return <p className="error" role="alert">Admin sign-in isn’t set up for this site. See “Admin sign-in” in the README.</p>;
  }
  return (
    <div className="card stack gap-14" style={{ padding: 26, maxWidth: 460 }}>
      <p style={{ margin: 0, fontSize: 15 }}>Sign in with your admin account.</p>
      {msg && <p className="error" role="alert">{msg}</p>}
      <button className="btn btn-primary self-start" disabled={busy} onClick={() => { setBusy(true); signIn(cfg).catch(() => setBusy(false)); }}>{busy ? 'Opening sign-in…' : 'Sign in'}</button>
    </div>
  );
}

function Dashboard({ token, data, onChanged }: { token: string; data: Data; onChanged: () => void }) {
  const [tab, setTab] = useState<Tab>('Overview');
  const exportAs = (e: Export) => download(`mybigquest-${e.file}-${csvDate(Date.now()).slice(0, 10)}.csv`, e.csv(data));
  return (
    <>
      <div className="row gap-8">
        <div className="row gap-8" role="tablist">
          {TABS.map(t => <button key={t} role="tab" className="filter" aria-selected={tab === t} aria-pressed={tab === t} onClick={() => setTab(t)}>{t}</button>)}
        </div>
        <div className="row gap-8 ml-auto">
          {(EXPORTS[tab] ?? []).map((e, i) => (
            <button key={e.file} className={i === 0 ? 'btn btn-secondary' : 'btn btn-ghost'} disabled={e.empty(data)} onClick={() => exportAs(e)}>{e.label}</button>
          ))}
        </div>
      </div>
      {tab === 'Overview' && <Overview data={data} />}
      {tab === 'Mentor requests' && <Requests token={token} rows={data.requests} onChanged={onChanged} />}
      {tab === 'Feedback' && <Feedback rows={data.feedback} />}
      {tab === 'Quiz sessions' && <Sessions rows={data.sessions} />}
    </>
  );
}

function Overview({ data }: { data: Data }) {
  const finished = useMemo(() => data.sessions.filter(s => s.completedAt), [data.sessions]);
  const areas = useMemo(() => {
    const counts = Object.fromEntries(AREAS.map(a => [a.k, { gap: 0, partly: 0, covered: 0 }]));
    for (const s of finished) for (const [k, v] of Object.entries(summarize(s.answers).statuses)) counts[k][v]++;
    return counts;
  }, [finished]);
  const ratings = data.feedback.reduce<Record<string, number>>((acc, f) => ({ ...acc, [f.rating]: (acc[f.rating] ?? 0) + 1 }), {});
  const tiles: [string, number][] = [
    ['Quizzes started', data.sessions.length], ['Quizzes finished', finished.length],
    ['Feedback', data.feedback.length], ['New mentor requests', data.requests.filter(r => r.status === 'new').length],
  ];
  return (
    <div className="stack gap-22">
      <div className="grid auto-280" style={{ gap: 14 }}>
        {tiles.map(([l, v]) => <div key={l} className="card" style={{ padding: 20, gap: 4 }}><span className="small muted">{l}</span><span className="stat" style={{ fontSize: 34 }}>{v}</span></div>)}
      </div>
      <div className="card scroll-x" style={{ padding: 22, gap: 12 }}>
        <h4 style={{ margin: 0 }}>Finished quizzes by area</h4>
        <table className="table admin-table">
          <thead><tr><th>Area</th><th>Gap</th><th>Partly</th><th>Covered</th></tr></thead>
          <tbody>{AREAS.map(a => <tr key={a.k}><td>{a.title}</td><td>{areas[a.k].gap}</td><td>{areas[a.k].partly}</td><td>{areas[a.k].covered}</td></tr>)}</tbody>
        </table>
      </div>
      <div className="card" style={{ padding: 22, gap: 8 }}>
        <h4 style={{ margin: 0 }}>Feedback ratings</h4>
        {Object.keys(ratings).length ? Object.entries(ratings).map(([r, n]) => <span key={r}>{r}: <b>{n}</b></span>) : <span className="muted">None yet.</span>}
      </div>
    </div>
  );
}

function Requests({ token, rows, onChanged }: { token: string; rows: RequestRow[]; onChanged: () => void }) {
  const [saving, setSaving] = useState('');
  const [error, setError] = useState('');
  if (!rows.length) return <p className="muted">No mentor requests yet.</p>;
  const change = async (id: string, status: string) => {
    setSaving(id); setError('');
    try { await api.admin.setRequestStatus(id, status, token); onChanged(); }
    catch { setError('Couldn’t update that request. Try again.'); }
    finally { setSaving(''); }
  };
  return (
    <div className="card scroll-x" style={{ padding: 22 }}>
      {error && <p className="error" role="alert">{error}</p>}
      <table className="table admin-table">
        <thead><tr><th>When</th><th>Mentor</th><th>Grade</th><th>Message</th><th>Parent email</th><th>Status</th></tr></thead>
        <tbody>{rows.map(r => (
          <tr key={r.id}>
            <td>{when(r.createdAt)}</td><td>{mentorName(r.mentorId)}</td><td>{r.grade ?? '—'}</td>
            <td style={{ minWidth: 260, whiteSpace: 'pre-wrap' }}>{r.message}</td>
            <td><a href={'mailto:' + r.parentEmail}>{r.parentEmail}</a></td>
            <td><select className="input" value={r.status} disabled={saving === r.id} onChange={e => change(r.id, e.target.value)} aria-label="Status">{REQUEST_STATUSES.map(s => <option key={s}>{s}</option>)}</select></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function Feedback({ rows }: { rows: FeedbackRow[] }) {
  if (!rows.length) return <p className="muted">No feedback yet.</p>;
  return (
    <div className="card scroll-x" style={{ padding: 22 }}>
      <table className="table admin-table">
        <thead><tr><th>When</th><th>Rating</th><th>Most useful</th><th>Felt wrong</th><th>Wishes</th></tr></thead>
        <tbody>{rows.map(f => <tr key={f.id}><td>{when(f.createdAt)}</td><td>{f.rating}</td><td>{areaTitle(f.useful)}</td><td style={{ whiteSpace: 'pre-wrap' }}>{f.wrong || '—'}</td><td style={{ whiteSpace: 'pre-wrap' }}>{f.wish || '—'}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

function Sessions({ rows }: { rows: SessionRow[] }) {
  if (!rows.length) return <p className="muted">No quiz sessions yet.</p>;
  return (
    <div className="card scroll-x" style={{ padding: 22 }}>
      <table className="table admin-table">
        <thead><tr><th>Started</th><th>Name</th><th>Grade</th><th>Progress</th><th>Gaps / partly / covered</th></tr></thead>
        <tbody>{rows.map(s => {
          const sum = summarize(s.answers);
          return (
            <tr key={s.id}><td>{when(s.createdAt)}</td><td>{s.name || '—'}</td><td>{sum.grade ?? '—'}</td>
              <td>{s.completedAt ? 'Finished' : `Question ${Math.min(s.pos + 1, QUESTION_COUNT)} of ${QUESTION_COUNT}`}</td>
              <td>{s.completedAt ? `${sum.gapCount} / ${sum.partlyCount} / ${sum.coveredCount}` : '—'}</td></tr>
          );
        })}</tbody>
      </table>
    </div>
  );
}
