import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FIELDS, GRADES, firstName, initials, type Mentor } from '@mbq/shared';
import { api, ApiError } from '../lib/api';
import { clientId, load, save } from '../lib/storage';
import { gapTitles, savedQuiz } from '../lib/quizState';

const SENT_KEY = 'mbq-sent';

export function Mentors() {
  const [params] = useSearchParams();
  const [mentors, setMentors] = useState<Mentor[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [filter, setFilter] = useState('All');
  const [open, setOpen] = useState<Mentor | null>(null);
  const [sent, setSent] = useState<Record<string, boolean>>(() => load(SENT_KEY, {}));

  useEffect(() => {
    api.mentors().then(setMentors).catch(() => setLoadError(true));
  }, []);

  // Tips links straight to one mentor with ?ask=<id>.
  useEffect(() => {
    const id = params.get('ask');
    const m = id && mentors?.find(x => x.id === id);
    if (m) setOpen(m);
  }, [mentors, params]);

  const markSent = (id: string) => { const next = { ...sent, [id]: true }; setSent(next); save(SENT_KEY, next); };
  const shown = (mentors || []).filter(m => filter === 'All' || m.field === filter);

  return (
    <main className="wrap page gap-32">
      <section className="stack gap-14 mw-640">
        <h1 className="h-page">Talk to someone who does the job</h1>
        <p className="lead" style={{ fontSize: 17 }}>Working professionals who give 20 minutes to answer your questions about their field, and what they’d do at your age. A parent or guardian is copied on every request.</p>
      </section>
      <div className="row gap-8" role="group" aria-label="Filter by field">
        {['All', ...FIELDS].map(f => <button key={f} className="filter" aria-pressed={filter === f} onClick={() => setFilter(f)}>{f}</button>)}
      </div>
      {loadError && <p className="error" role="alert">Couldn’t load the mentors. Refresh the page to try again.</p>}
      {!mentors && !loadError && <p className="muted">Loading mentors…</p>}
      <div className="grid auto-300" style={{ gap: 18 }}>
        {shown.map((m, i) => (
          <div key={m.id} className="card" style={{ padding: 24, gap: 14 }}>
            <div className="row gap-14" style={{ flexWrap: 'nowrap' }}>
              <span className="avatar" style={{ background: i % 2 ? 'var(--color-accent)' : 'var(--color-accent-2)' }} aria-hidden="true">{initials(m.name)}</span>
              <div className="stack" style={{ gap: 2 }}><span className="card-title" style={{ fontSize: 19 }}>{m.name}</span><span className="muted" style={{ fontSize: 14 }}>{m.role}</span></div>
            </div>
            <div className="row gap-8"><span className="tag tag-accent-2">{m.field}</span><span className="tag tag-neutral">{m.years} years in the field</span></div>
            <p style={{ margin: 0, fontSize: 14, color: 'var(--color-neutral-900)' }}>{m.bio}</p>
            <div className="stack gap-8">
              <span className="tiny" style={{ color: 'var(--color-neutral-700)' }}>Ask about</span>
              <div className="row gap-8">{m.helps.map(h => <span key={h} className="tag tag-outline" style={{ color: 'var(--color-accent-700)', borderColor: 'var(--color-accent-400)' }}>{h}</span>)}</div>
            </div>
            <button className={'btn ' + (sent[m.id] ? 'btn-secondary' : 'btn-primary')} disabled={!!sent[m.id]} onClick={() => setOpen(m)}
              style={{ marginTop: 'auto', alignSelf: 'flex-start', fontSize: 15, padding: '10px 20px' }}>{sent[m.id] ? 'Request sent' : 'Ask for a chat'}</button>
          </div>
        ))}
      </div>
      {open && <RequestDialog mentor={open} fromResults={params.get('from') === 'results'} onClose={() => setOpen(null)} onSent={() => markSent(open.id)} />}
    </main>
  );
}

function defaultMessage(m: Mentor, grade: string, fromResults: boolean) {
  const first = firstName(m.name);
  const quiz = savedQuiz();
  const who = grade ? 'I’m in ' + grade + 'th grade' : 'I’m a student';
  if (fromResults && quiz.done) {
    const gaps = gapTitles(quiz.answers).slice(0, 3).map(t => t.toLowerCase());
    if (gaps.length) return `Hi ${first}, ${who}. GapFinder says my biggest gaps are ${gaps.join(', ')}. How would you work on that at my age?`;
  }
  return `Hi ${first}, ${who} and I’m curious about ${m.field === 'Not sure yet' ? 'a few different fields' : m.field.toLowerCase()}. What do you wish you’d known at my age?`;
}

function RequestDialog({ mentor, fromResults, onClose, onSent }: { mentor: Mentor; fromResults: boolean; onClose: () => void; onSent: () => void }) {
  const quiz = savedQuiz();
  const [grade, setGrade] = useState(quiz.answers.grade || '');
  const [msg, setMsg] = useState(() => defaultMessage(mentor, quiz.answers.grade || '', fromResults));
  const [email, setEmail] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const first = firstName(mentor.name);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('textarea, button')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const canSend = msg.trim() && emailOk && consent && !busy;

  const send = async () => {
    setBusy(true); setError('');
    try {
      await api.requestMentor({ clientId, sessionId: quiz.started ? quiz.sessionId : null, mentorId: mentor.id, grade: grade ? Number(grade) : null, message: msg.trim(), parentEmail: email.trim() });
      onSent();
      setDone(true);
    } catch (e) {
      setError(e instanceof ApiError && e.status === 400 ? 'Check the email address and your message.' : 'Couldn’t send just now. Try again in a minute.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dialog-backdrop" style={{ zIndex: 20 }} onClick={onClose}>
      <div ref={ref} className="dialog" role="dialog" aria-modal="true" aria-labelledby="req-title" style={{ width: 'min(520px, 100%)', maxHeight: 'calc(100vh - 32px)', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        {!done ? (
          <>
            <div id="req-title" className="dialog-title" style={{ fontSize: 24 }}>Ask {first} for a chat</div>
            <p className="dialog-body" style={{ margin: 0 }}>{mentor.name} · {mentor.role}. Chats are 20-minute video calls. Your parent or guardian gets a copy of this request.</p>
            <div className="field"><label htmlFor="req-msg">Your message</label><textarea id="req-msg" className="input" value={msg} maxLength={2000} onChange={e => setMsg(e.target.value)} style={{ minHeight: 130, borderRadius: 22, fontSize: 15 }} /></div>
            <div className="field"><label htmlFor="req-grade">Your grade</label>
              <select id="req-grade" className="input" value={grade} onChange={e => setGrade(e.target.value)} style={{ minHeight: 44 }}>
                <option value="">Prefer not to say</option>
                {GRADES.map(g => <option key={g} value={String(g)}>{g}th grade</option>)}
              </select>
            </div>
            <div className="field"><label htmlFor="req-email">Parent or guardian’s email</label>
              <input id="req-email" className="input" type="email" autoComplete="off" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@example.com" style={{ minHeight: 44 }} />
              <span className="tiny muted">We email them, not you, to set up a time. We don’t use it for anything else.</span>
            </div>
            <label className="check-row"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} /><span>My parent or guardian knows I’m asking for this chat.</span></label>
            {error && <p className="error" role="alert">{error}</p>}
            <div className="dialog-actions">
              <button className="btn btn-secondary" style={{ fontSize: 15, padding: '10px 18px' }} onClick={onClose}>Cancel</button>
              <button className="btn btn-primary" style={{ fontSize: 15, padding: '10px 20px' }} disabled={!canSend} onClick={send}>{busy ? 'Sending…' : 'Send request'}</button>
            </div>
          </>
        ) : (
          <>
            <div id="req-title" className="dialog-title" style={{ fontSize: 24 }}>Request sent</div>
            <p className="dialog-body" style={{ margin: 0 }}>{first} usually replies within a few days. We’ll email your parent or guardian with times that work.</p>
            <div className="dialog-actions"><button className="btn btn-primary" style={{ fontSize: 15, padding: '10px 20px' }} onClick={onClose}>Done</button></div>
          </>
        )}
      </div>
    </div>
  );
}
