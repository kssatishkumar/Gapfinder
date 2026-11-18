import { useCallback, useEffect, useState } from 'react';
import { AREAS, REQUEST_STATUSES } from '@mbq/shared';
import { api, ApiError } from '../lib/api';

const TOKEN_KEY = 'mbq-admin-token';
const getToken = () => { try { return sessionStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } };
const setToken = (t: string) => { try { t ? sessionStorage.setItem(TOKEN_KEY, t) : sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } };
const areaTitle = (k: string | null) => AREAS.find(a => a.k === k)?.title ?? '—';
const when = (s: string | null) => (s ? new Date(s).toLocaleString() : '—');

interface Summary {
  sessions: { started: number; completed: number; variant_a: number; variant_b: number; completed_a: number; completed_b: number };
  areas: { area: string; gap: number; partly: number; covered: number }[];
  feedback: { rating: string; n: number }[];
  requests: { status: string; n: number }[];
}
interface Req { id: string; mentor_name: string; grade: number | null; message: string; parent_email: string; status: string; created_at: string }
interface Fb { id: string; rating: string; useful: string | null; wrong: string; wish: string; created_at: string }
interface Sess { id: string; variant: string; grade: number | null; pos: number; summary: { gapCount: number; partlyCount: number; coveredCount: number } | null; completed_at: string | null; created_at: string }

const TABS = ['Overview', 'Mentor requests', 'Feedback', 'Quiz sessions'] as const;

export function Admin() {
  const [token, setTok] = useState(getToken);
  const signOut = useCallback(() => { setToken(''); setTok(''); }, []);
  return (
    <main className="wrap page gap-22">
      <div className="row gap-10">
        <h1 className="h-page">Admin</h1>
        {token && <button className="btn btn-ghost ml-auto" onClick={signOut}>Sign out</button>}
      </div>
      {token ? <Dashboard token={token} onAuthFail={signOut} /> : <Login onToken={t => { setToken(t); setTok(t); }} />}
    </main>
  );
}

function Login({ onToken }: { onToken: (t: string) => void }) {
  const [pw, setPw] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    try { onToken((await api.admin.login(pw)).token); }
    catch (err) { setError(err instanceof ApiError && err.status === 401 ? 'Wrong password.' : 'Couldn’t sign in. Try again.'); }
    finally { setBusy(false); }
  };
  return (
    <form className="card stack gap-14" style={{ padding: 26, maxWidth: 420 }} onSubmit={submit}>
      <div className="field"><label htmlFor="admin-pw">Password</label><input id="admin-pw" className="input" type="password" autoComplete="current-password" value={pw} onChange={e => setPw(e.target.value)} style={{ minHeight: 44 }} /></div>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="btn btn-primary self-start" disabled={!pw || busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
    </form>
  );
}

function useAdminData<T>(path: string, token: string, onAuthFail: () => void) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const reload = useCallback(() => {
    api.admin.get<T>(path, token).then(setData).catch(e => {
      if (e instanceof ApiError && e.status === 401) onAuthFail(); else setError('Couldn’t load this. Refresh to try again.');
    });
  }, [path, token, onAuthFail]);
  useEffect(reload, [reload]);
  return { data, error, reload };
}

function Dashboard({ token, onAuthFail }: { token: string; onAuthFail: () => void }) {
  const [tab, setTab] = useState<(typeof TABS)[number]>('Overview');
  return (
    <>
      <div className="row gap-8" role="tablist">
        {TABS.map(t => <button key={t} role="tab" className="filter" aria-selected={tab === t} aria-pressed={tab === t} onClick={() => setTab(t)}>{t}</button>)}
      </div>
      {tab === 'Overview' && <Overview token={token} onAuthFail={onAuthFail} />}
      {tab === 'Mentor requests' && <Requests token={token} onAuthFail={onAuthFail} />}
      {tab === 'Feedback' && <Feedback token={token} onAuthFail={onAuthFail} />}
      {tab === 'Quiz sessions' && <Sessions token={token} onAuthFail={onAuthFail} />}
    </>
  );
}

type P = { token: string; onAuthFail: () => void };
const Status = ({ error, loading }: { error: string; loading: boolean }) =>
  error ? <p className="error" role="alert">{error}</p> : loading ? <p className="muted">Loading…</p> : null;

function Overview({ token, onAuthFail }: P) {
  const { data, error } = useAdminData<Summary>('summary', token, onAuthFail);
  if (!data) return <Status error={error} loading />;
  const s = data.sessions;
  const tiles = [
    ['Quizzes started', s.started], ['Quizzes finished', s.completed],
    ['Variant A finished', s.variant_a ? `${s.completed_a} of ${s.variant_a}` : '—'], ['Variant B finished', s.variant_b ? `${s.completed_b} of ${s.variant_b}` : '—'],
    ['Feedback', data.feedback.reduce((a, f) => a + f.n, 0)], ['New mentor requests', data.requests.find(r => r.status === 'new')?.n ?? 0],
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
          <tbody>{AREAS.map(a => { const r = data.areas.find(x => x.area === a.k); return <tr key={a.k}><td>{a.title}</td><td>{r?.gap ?? 0}</td><td>{r?.partly ?? 0}</td><td>{r?.covered ?? 0}</td></tr>; })}</tbody>
        </table>
      </div>
      <div className="card" style={{ padding: 22, gap: 8 }}>
        <h4 style={{ margin: 0 }}>Feedback ratings</h4>
        {data.feedback.length ? data.feedback.map(f => <span key={f.rating}>{f.rating}: <b>{f.n}</b></span>) : <span className="muted">None yet.</span>}
      </div>
    </div>
  );
}

function Requests({ token, onAuthFail }: P) {
  const { data, error, reload } = useAdminData<Req[]>('requests', token, onAuthFail);
  const [saving, setSaving] = useState('');
  if (!data) return <Status error={error} loading />;
  if (!data.length) return <p className="muted">No mentor requests yet.</p>;
  const change = async (id: string, status: string) => {
    setSaving(id);
    try { await api.admin.setRequestStatus(id, status, token); reload(); } finally { setSaving(''); }
  };
  return (
    <div className="card scroll-x" style={{ padding: 22 }}>
      <table className="table admin-table">
        <thead><tr><th>When</th><th>Mentor</th><th>Grade</th><th>Message</th><th>Parent email</th><th>Status</th></tr></thead>
        <tbody>{data.map(r => (
          <tr key={r.id}>
            <td>{when(r.created_at)}</td><td>{r.mentor_name}</td><td>{r.grade ?? '—'}</td>
            <td style={{ minWidth: 260, whiteSpace: 'pre-wrap' }}>{r.message}</td>
            <td><a href={'mailto:' + r.parent_email}>{r.parent_email}</a></td>
            <td><select className="input" value={r.status} disabled={saving === r.id} onChange={e => change(r.id, e.target.value)} aria-label="Status">{REQUEST_STATUSES.map(s => <option key={s}>{s}</option>)}</select></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function Feedback({ token, onAuthFail }: P) {
  const { data, error } = useAdminData<Fb[]>('feedback', token, onAuthFail);
  if (!data) return <Status error={error} loading />;
  if (!data.length) return <p className="muted">No feedback yet.</p>;
  return (
    <div className="card scroll-x" style={{ padding: 22 }}>
      <table className="table admin-table">
        <thead><tr><th>When</th><th>Rating</th><th>Most useful</th><th>Felt wrong</th><th>Wishes</th></tr></thead>
        <tbody>{data.map(f => <tr key={f.id}><td>{when(f.created_at)}</td><td>{f.rating}</td><td>{areaTitle(f.useful)}</td><td style={{ whiteSpace: 'pre-wrap' }}>{f.wrong || '—'}</td><td style={{ whiteSpace: 'pre-wrap' }}>{f.wish || '—'}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

function Sessions({ token, onAuthFail }: P) {
  const { data, error } = useAdminData<Sess[]>('sessions', token, onAuthFail);
  if (!data) return <Status error={error} loading />;
  if (!data.length) return <p className="muted">No quiz sessions yet.</p>;
  return (
    <div className="card scroll-x" style={{ padding: 22 }}>
      <table className="table admin-table">
        <thead><tr><th>Started</th><th>Variant</th><th>Grade</th><th>Progress</th><th>Gaps / partly / covered</th></tr></thead>
        <tbody>{data.map(s => (
          <tr key={s.id}><td>{when(s.created_at)}</td><td>{s.variant}</td><td>{s.grade ?? '—'}</td>
            <td>{s.completed_at ? 'Finished' : `Question ${Math.min(s.pos + 1, 9)} of 9`}</td>
            <td>{s.summary ? `${s.summary.gapCount} / ${s.summary.partlyCount} / ${s.summary.coveredCount}` : '—'}</td></tr>
        ))}</tbody>
      </table>
    </div>
  );
}
