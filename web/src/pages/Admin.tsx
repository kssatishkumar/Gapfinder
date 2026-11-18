import { useCallback, useEffect, useState } from 'react';
import { AREAS, REQUEST_STATUSES } from '@mbq/shared';
import { api, ApiError } from '../lib/api';
import { completeSignIn, currentToken, fetchAuthConfig, forgetToken, signIn, signOut, type AuthConfig } from '../lib/auth';

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

type View =
  | { s: 'loading' }
  | { s: 'error'; msg: string }
  | { s: 'signedOut'; cfg: AuthConfig; msg?: string }
  | { s: 'forbidden'; cfg: AuthConfig; email: string | null }
  | { s: 'in'; cfg: AuthConfig; token: string; email: string | null };

export function Admin() {
  const [view, setView] = useState<View>({ s: 'loading' });

  const refresh = useCallback(async (cfg: AuthConfig, msg?: string) => {
    const cur = currentToken(cfg);
    if (!cur) return setView({ s: 'signedOut', cfg, msg });
    try {
      const me = await api.admin.me(cur.token);
      setView({ s: 'in', cfg, token: cur.token, email: cur.email ?? me.email });
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) return setView({ s: 'forbidden', cfg, email: cur.email });
      if (e instanceof ApiError && e.status === 401) { forgetToken(); return setView({ s: 'signedOut', cfg, msg: 'Your session ended. Sign in again.' }); }
      setView({ s: 'error', msg: 'Couldn’t reach the server. Refresh to try again.' });
    }
  }, []);

  useEffect(() => {
    (async () => {
      let cfg: AuthConfig;
      try { cfg = await fetchAuthConfig(); } catch { return setView({ s: 'error', msg: 'Couldn’t reach the server. Refresh to try again.' }); }
      let msg: string | undefined;
      try { await completeSignIn(cfg); } catch (e) { msg = (e as Error).message; }
      await refresh(cfg, msg);
    })();
  }, [refresh]);

  const onAuthFail = useCallback(() => {
    if (view.s !== 'in') return;
    forgetToken();
    setView({ s: 'signedOut', cfg: view.cfg, msg: 'Your session ended. Sign in again.' });
  }, [view]);

  return (
    <main className="wrap page gap-22">
      <div className="row gap-10">
        <h1 className="h-page">Admin</h1>
        {(view.s === 'in' || view.s === 'forbidden') && (
          <div className="row gap-10 ml-auto">
            {view.email && <span className="small muted">{view.email}</span>}
            {view.cfg.mode === 'cognito' && <button className="btn btn-ghost" onClick={() => signOut(view.cfg)}>Sign out</button>}
          </div>
        )}
      </div>
      {view.s === 'loading' && <p className="muted">Loading…</p>}
      {view.s === 'error' && <p className="error" role="alert">{view.msg}</p>}
      {view.s === 'signedOut' && <SignIn cfg={view.cfg} msg={view.msg} />}
      {view.s === 'forbidden' && (
        <div className="card stack gap-10" style={{ padding: 26, maxWidth: 520 }}>
          <h4 style={{ margin: 0 }}>This account isn’t an admin</h4>
          <p className="muted" style={{ margin: 0, fontSize: 15 }}>Ask an existing admin to add you to the “admins” group in Cognito, then sign out and back in.</p>
        </div>
      )}
      {view.s === 'in' && <Dashboard token={view.token} onAuthFail={onAuthFail} />}
    </main>
  );
}

function SignIn({ cfg, msg }: { cfg: AuthConfig; msg?: string }) {
  const [busy, setBusy] = useState(false);
  if (cfg.mode !== 'cognito') {
    return <p className="error" role="alert">Admin sign-in isn’t set up on this server. See “Admin sign-in” in the README.</p>;
  }
  return (
    <div className="card stack gap-14" style={{ padding: 26, maxWidth: 460 }}>
      <p style={{ margin: 0, fontSize: 15 }}>Sign in with your admin account.</p>
      {msg && <p className="error" role="alert">{msg}</p>}
      <button className="btn btn-primary self-start" disabled={busy} onClick={() => { setBusy(true); signIn(cfg).catch(() => setBusy(false)); }}>{busy ? 'Opening sign-in…' : 'Sign in'}</button>
    </div>
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
