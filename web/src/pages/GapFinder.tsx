import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { AREAS, NAME_MAX, QUESTIONS, QUESTION_COUNT, TEXT_MAX, RATINGS, answerLabel, isHighSchool, summarize, type Answers, type Question } from '@mbq/shared';
import { useQuiz } from '../lib/quizState';
import { clientId } from '../lib/storage';
import { SHOW_MENTORS } from '../lib/features';
import { api } from '../lib/api';
import { Icon } from '../components/Icon';

type Quiz = ReturnType<typeof useQuiz>;

export function GapFinder() {
  const quiz = useQuiz();
  const [fb, setFb] = useState<null | 'form' | 'sent'>(null);
  const adv = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(adv.current), []);

  // Keep the view at the top between screens.
  useEffect(() => { window.scrollTo(0, 0); }, [quiz.started, quiz.pos, quiz.done, fb]);

  // Show the picked answer for a moment, then move to the next question.
  const answer = (q: Question, id: string) => {
    quiz.update(p => ({ answers: { ...p.answers, [q.id]: id } }));
    clearTimeout(adv.current);
    adv.current = setTimeout(() => quiz.update(p => ({ pos: Math.min(p.pos + 1, QUESTION_COUNT) })), 260);
  };
  const setPos = (i: number) => { clearTimeout(adv.current); setFb(null); quiz.update({ pos: i, started: true }); };
  const restart = () => { clearTimeout(adv.current); setFb(null); quiz.reset(); };

  let body;
  // Older saved progress has no name: ask for it before carrying on.
  if (!quiz.started || !quiz.name.trim()) body = <Intro quiz={quiz} onRestart={restart} />;
  else if (!quiz.done) body = <QuizPaged quiz={quiz} onAnswer={answer} />;
  else if (fb === 'form') body = <FeedbackForm quiz={quiz} onClose={() => setFb(null)} onSent={() => setFb('sent')} />;
  else if (fb === 'sent') body = <FeedbackSent onClose={() => setFb(null)} onRestart={restart} />;
  else body = <Results name={quiz.name.trim()} answers={quiz.answers} onFeedback={() => setFb('form')} onEdit={() => setPos(0)} onRestart={restart} />;

  return <main className="wrap stack gap-28" style={{ paddingTop: 4, paddingBottom: 56 }}>{body}</main>;
}

function Intro({ quiz, onRestart }: { quiz: Quiz; onRestart: () => void }) {
  const hasProgress = quiz.pos > 0;
  const [tried, setTried] = useState(false);
  const hasName = !!quiz.name.trim();
  const start = (e: FormEvent) => {
    e.preventDefault();
    if (!hasName) { setTried(true); document.getElementById('quiz-name')?.focus(); return; }
    quiz.update(p => ({ name: p.name.trim(), started: true }));
  };
  return (
    <section className="grid auto-380" style={{ gap: 48, paddingTop: 20 }}>
      <div className="stack gap-22 mw-600">
        <span className="tag tag-accent-2 self-start" style={{ fontSize: 13, padding: '5px 14px' }}>For students in grades 6–12</span>
        <h1 style={{ margin: 0, fontSize: 'clamp(40px,7vw,58px)' }}>GapFinder</h1>
        <p className="lead">Find what’s missing from your plan to get ready for college. The questions come from what students told us, and the answers come from what colleges say they look for.</p>
        <ol className="steps">
          <li><span className="num" style={{ background: 'var(--color-accent)' }}>1</span><span>Answer 9 quick questions about your classes, habits and what you do outside school.</span></li>
          <li><span className="num" style={{ background: 'var(--color-accent-2)' }}>2</span><span>See your gaps, what colleges look for in each one, and a first step.</span></li>
        </ol>
        <div className="row gap-8"><span className="tag tag-neutral">9 questions</span><span className="tag tag-neutral">About 1 minute</span><span className="tag tag-neutral">No sign-up</span></div>
        <form className="stack gap-14" style={{ marginTop: 4 }} onSubmit={start} noValidate>
          <div className="field mw-560">
            <label htmlFor="quiz-name">Your name</label>
            <input id="quiz-name" className="input" value={quiz.name} maxLength={NAME_MAX} autoComplete="given-name" placeholder="First name is fine"
              aria-invalid={tried && !hasName} aria-describedby={tried && !hasName ? 'quiz-name-err' : undefined}
              onChange={e => { const v = e.target.value; quiz.update({ name: v }); }} style={{ minHeight: 52, fontSize: 16 }} />
            {tried && !hasName && <span id="quiz-name-err" className="small" style={{ color: 'var(--color-accent-800)', fontWeight: 600 }}>Enter your name to start.</span>}
          </div>
          <div className="row gap-10">
            <button type="submit" className="btn btn-primary btn-lg">{hasProgress ? 'Continue where I left off' : 'Start'}</button>
            {hasProgress && <button type="button" className="btn btn-ghost" style={{ fontSize: 16 }} onClick={onRestart}>Start over</button>}
          </div>
        </form>
        <p className="tiny muted" style={{ margin: 0 }}>We save your name and answers to improve GapFinder. Your progress is also kept on this device.</p>
      </div>
      <div className="stack gap-16">
        <div className="card elev-sm" style={{ padding: 26, gap: 12, background: 'var(--color-accent-2-100)' }}>
          <span className="card-kicker" style={{ fontSize: 11, color: 'var(--color-accent-2-800)' }}>Built from a student survey</span>
          <div className="row gap-10" style={{ alignItems: 'baseline' }}><span style={{ fontFamily: 'var(--font-heading)', fontSize: 52, lineHeight: 1, color: 'var(--color-accent-2-800)' }}>28</span><span style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-accent-2-900)' }}>students in grades 7–9</span></div>
          <p style={{ margin: 0, fontSize: 15, color: 'var(--color-accent-2-900)' }}>told us what they do, what they want to start, and what they wish someone would explain about getting ready for college.</p>
        </div>
        <div className="card" style={{ padding: 24, gap: 14 }}>
          <h4 style={{ margin: 0 }}>Checked against what colleges publish</h4>
          <div className="stack gap-10">
            {[
              ['NACAC admission factors survey', 'What colleges across the US say matters most'],
              ['University of Washington review factors', 'How UW reads transcripts, essays and activities'],
              ['Harvard reader guidelines', 'How readers rate activities and teacher letters, made public in a court case'],
              ['Johns Hopkins “Essays That Worked”', 'Real essays from admitted students, with comments from admissions'],
              ['Yale, Stanford and MIT admissions', 'What each says it looks for'],
              ['Harvard Crimson freshman survey', 'What admitted students did in high school'],
            ].map(([t, d]) => <div key={t} className="stack" style={{ gap: 2 }}><span style={{ fontSize: 15, fontWeight: 600 }}>{t}</span><span className="small muted">{d}</span></div>)}
          </div>
        </div>
      </div>
    </section>
  );
}

function TextInput({ q, answers, update }: { q: Question; answers: Answers; update: Quiz['update'] }) {
  if (!q.text) return null;
  return (
    <div className="field">
      <label htmlFor={'text-' + q.id}>{q.text.label} (optional)</label>
      <input id={'text-' + q.id} className="input" value={answers[q.id + '_text'] || ''} maxLength={TEXT_MAX} placeholder={q.text.ph}
        onChange={e => { const v = e.target.value; update(p => ({ answers: { ...p.answers, [q.id + '_text']: v } })); }}
        style={{ minHeight: 52, fontSize: 16 }} />
    </div>
  );
}

function QuizPaged({ quiz, onAnswer }: { quiz: Quiz; onAnswer: (q: Question, id: string) => void }) {
  const q = QUESTIONS[quiz.pos];
  const prev = () => quiz.update(p => (p.pos === 0 ? { started: false } : { pos: p.pos - 1 }));
  return (
    <section className="stack gap-22 mw-640">
      <div className="row gap-10">
        <button className="btn btn-ghost btn-back" onClick={prev}><Icon name="back" />Back</button>
        <span className="ml-auto small muted">Question {quiz.pos + 1} of {QUESTION_COUNT}</span>
      </div>
      <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={QUESTION_COUNT} aria-valuenow={quiz.pos}><div style={{ width: Math.round(quiz.pos / QUESTION_COUNT * 100) + '%' }} /></div>
      <div className="stack gap-10">
        <h2 className="h-q">{q.title}</h2>
        {q.help && <p className="muted" style={{ margin: 0, fontSize: 15 }}>{q.help}</p>}
      </div>
      <TextInput q={q} answers={quiz.answers} update={quiz.update} />
      <div className="stack gap-10">
        {q.options.map(o => (
          <button key={o.id} className="opt" aria-pressed={quiz.answers[q.id] === o.id} onClick={() => onAnswer(q, o.id)}>
            <span className="opt-check">{quiz.answers[q.id] === o.id && <Icon name="check" size={14} />}</span>
            <span className="opt-label">{o.label}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

const FACTORS = [['Grades in core classes', 77], ['How hard your classes are', 64], ['SAT or ACT scores', 5]] as const;

function Results({ name, answers, onFeedback, onEdit, onRestart }: { name: string; answers: Answers; onFeedback: () => void; onEdit: () => void; onRestart: () => void }) {
  const st = summarize(answers).statuses;
  const hs = isHighSchool(answers);
  const todo = AREAS.filter(a => st[a.k] !== 'covered').sort((a, b) => (st[a.k] === 'gap' ? 0 : 1) - (st[b.k] === 'gap' ? 0 : 1));
  const covered = AREAS.filter(a => st[a.k] === 'covered');
  const gapN = todo.filter(a => st[a.k] === 'gap').length, partN = todo.length - gapN;
  const headline = todo.length === 0 ? 'No gaps. You’ve got all 8 covered.' : todo.length === 1 ? 'You have 1 gap to work on' : 'You have ' + todo.length + ' gaps to work on';
  const summary = todo.length === 0 ? 'Keep doing what you’re doing. Come back each year to check again.'
    : 'We compared your answers with what colleges say they look for. ' + (gapN ? gapN + (gapN === 1 ? ' is missing' : ' are missing') : '') + (gapN && partN ? ' and ' : '') + (partN ? partN + (partN === 1 ? ' is partly there' : ' are partly there') : '') + '. Each one comes with a first step.';
  const depthText = answers.depth_text?.trim();

  return (
    <>
      <section className="grid auto-360" style={{ gap: 32, paddingTop: 8 }}>
        <div className="stack gap-14 mw-620">
          <span className="card-kicker kicker">{name ? `${name}’s GapFinder results` : 'Your GapFinder results'}</span>
          <h1 style={{ margin: 0, fontSize: 'clamp(34px,5.4vw,50px)', textWrap: 'balance' }}>{headline}</h1>
          <p className="muted" style={{ margin: 0, fontSize: 17 }}>{summary}</p>
        </div>
        <div className="card" style={{ padding: 24, gap: 14 }}>
          <h4 style={{ margin: 0 }}>What colleges say matters most</h4>
          {FACTORS.map(([label, pct]) => (
            <div key={label} className="stack" style={{ gap: 6 }}>
              <div className="row" style={{ justifyContent: 'space-between', fontSize: 14 }}><span style={{ fontWeight: 600 }}>{label}</span><span>{pct}%</span></div>
              <div className="bar"><div style={{ width: pct + '%' }} /></div>
            </div>
          ))}
          <p className="tiny muted" style={{ margin: 0 }}>Share of colleges that give each one “considerable importance.” NACAC, Fall 2023.</p>
        </div>
      </section>

      {todo.length > 0 && (
        <section className="stack gap-16 mw-760">
          {todo.map(a => (
            <article key={a.k} className="card" style={{ padding: 24, gap: 16 }}>
              <div className="row gap-10">
                <span className={'tag ' + (st[a.k] === 'gap' ? 'tag-accent' : 'tag-neutral')}>{st[a.k] === 'gap' ? 'Gap' : 'Partly there'}</span>
                <span className="small muted">You said: {answerLabel(a.k, answers)}</span>
              </div>
              <h3 style={{ margin: 0, fontSize: 'clamp(22px,3.4vw,27px)' }}>{a.title}</h3>
              <div className="stack gap-10">
                <span className="label-caps muted">What colleges want</span>
                <ul className="stack gap-10" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  {a.wants.map(w => (
                    <li key={w.t} className="row gap-10" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
                      <span className="dot" />
                      <span className="stack" style={{ gap: 3 }}><span style={{ fontSize: 15, lineHeight: 1.5 }}>{w.t}</span><span className="tag tag-outline self-start" style={{ fontSize: 11, padding: '1px 8px' }}>{w.src}</span></span>
                    </li>
                  ))}
                </ul>
              </div>
              {a.admit && (
                <div className="callout" style={{ background: 'var(--color-accent-2-100)' }}>
                  <span className="label-caps" style={{ color: 'var(--color-accent-2-800)' }}>From students who got in</span>
                  <p style={{ color: 'var(--color-accent-2-900)' }}>{a.admit}</p>
                  <span className="tiny" style={{ color: 'var(--color-accent-2-800)' }}>{a.admitSrc}</span>
                </div>
              )}
              <div className="callout" style={{ background: 'var(--color-accent-100)' }}>
                <span className="label-caps" style={{ color: 'var(--color-accent-800)' }}>Your first step</span>
                <p>{a.k === 'depth' && depthText ? 'Set one goal in ' + depthText + ' this year, like placing in a competition, a performance or a finished project others can see.' : hs ? a.hs : a.ms}</p>
              </div>
              <p className="small" style={{ margin: 0, color: 'var(--color-accent-2-800)' }}>From our survey: {a.survey}</p>
            </article>
          ))}
        </section>
      )}

      {covered.length > 0 && (
        <section className="stack gap-10 mw-760">
          <h4 style={{ margin: 0 }}>Already covered</h4>
          <div className="row gap-8">{covered.map(a => <span key={a.k} className="tag tag-accent-2" style={{ fontSize: 14, padding: '6px 14px' }}>{a.title}</span>)}</div>
        </section>
      )}

      {SHOW_MENTORS && (
      <section className="band mw-760" style={{ background: 'var(--color-accent-2-100)' }}>
        <div className="stack" style={{ gap: 4, flex: 1, minWidth: 220 }}>
          <h4 style={{ margin: 0 }}>Talk it through with a mentor</h4>
          <p style={{ margin: 0, fontSize: 14, color: 'var(--color-accent-2-900)' }}>Ask someone who works in a field you like which of these gaps matter most for them.</p>
        </div>
        <Link to="/mentors?from=results" className="btn btn-secondary" style={{ fontSize: 16, padding: '12px 24px' }}>Find a mentor</Link>
      </section>
      )}

      <section className="band mw-760" style={{ background: 'var(--color-accent-100)' }}>
        <div className="stack" style={{ gap: 4, flex: 1, minWidth: 220 }}>
          <h4 style={{ margin: 0 }}>How did GapFinder do?</h4>
          <p style={{ margin: 0, fontSize: 14, color: 'var(--color-accent-900)' }}>Tell us what helped and what didn’t. It takes about a minute.</p>
        </div>
        <button className="btn btn-primary" style={{ fontSize: 16, padding: '12px 24px' }} onClick={onFeedback}>Give feedback</button>
      </section>

      <section className="row gap-10">
        <button className="btn btn-secondary btn-md" onClick={onEdit}>Change my answers</button>
        <button className="btn btn-ghost" style={{ fontSize: 15 }} onClick={onRestart}>Start over</button>
      </section>

      <section className="sources mw-760">
        <span style={{ fontWeight: 700, color: 'var(--color-text)' }}>Sources</span>
        <span>Student survey: 28 students in grades 7–9.</span>
        <a href="https://www.nacacnet.org/factors-in-the-admission-decision/" target="_blank" rel="noopener">NACAC, Factors in the Admission Decision (Fall 2023)</a>
        <a href="https://www.washington.edu/regents/meetings/meetings05/october/items/acad/a-4.pdf" target="_blank" rel="noopener">University of Washington, assessment factors in freshman holistic review</a>
        <span>University of Washington Common Data Set (factor ratings)</span>
        <a href="https://admissions.yale.edu/what-yale-looks-for" target="_blank" rel="noopener">Yale, What Yale Looks For</a>
        <a href="https://admissions.yale.edu/posts/2026-09-01-what-yale-looks-for-part-1-academic-strength" target="_blank" rel="noopener">Yale admissions podcast, What Yale Looks For Part 1</a>
        <a href="https://admission.stanford.edu/faqs/decision.html" target="_blank" rel="noopener">Stanford, Decision FAQs</a>
        <a href="https://mitadmissions.org/apply/process/what-we-look-for/" target="_blank" rel="noopener">MIT, What We Look For</a>
        <a href="https://www.thecrimson.com/article/2024/12/5/freshman-survey-2028-academics/" target="_blank" rel="noopener">Harvard Crimson, Class of 2028 freshman survey</a>
        <a href="https://www.law.cornell.edu/supremecourt/text/20-1199" target="_blank" rel="noopener">SFFA v. Harvard (2023), on Harvard’s reader ratings</a>
        <a href="https://apply.jhu.edu/college-planning-guide/essays-that-worked/" target="_blank" rel="noopener">Johns Hopkins, Essays That Worked</a>
      </section>
    </>
  );
}

function FeedbackForm({ quiz, onClose, onSent }: { quiz: Quiz; onClose: () => void; onSent: () => void }) {
  const [rating, setRating] = useState<(typeof RATINGS)[number] | null>(null);
  const [useful, setUseful] = useState<string | null>(null);
  const [wrong, setWrong] = useState('');
  const [wish, setWish] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const send = async () => {
    if (!rating) return;
    setBusy(true); setError('');
    try {
      await api.sendFeedback({ clientId, sessionId: quiz.sessionId, rating, useful, wrong, wish });
      onSent();
    } catch {
      setError('Couldn’t send just now. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="stack mw-640" style={{ gap: 26, paddingTop: 4 }}>
      <button className="btn btn-ghost btn-back self-start" onClick={onClose}><Icon name="back" />Back to my results</button>
      <div className="stack gap-8">
        <h1 style={{ margin: 0, fontSize: 'clamp(32px,5.4vw,46px)' }}>Give feedback</h1>
        <p className="muted" style={{ margin: 0, fontSize: 16 }}>GapFinder is still a first version. Your answers help us decide what to fix.</p>
      </div>
      <div className="stack gap-10">
        <h4 style={{ margin: 0 }}>How helpful was GapFinder?</h4>
        <div className="row gap-8">{RATINGS.map(l => <button key={l} className="pill" aria-pressed={rating === l} onClick={() => setRating(l)}>{l}</button>)}</div>
      </div>
      <div className="stack gap-10">
        <h4 style={{ margin: 0 }}>Which part was most useful?</h4>
        <div className="row gap-8">{AREAS.map(a => <button key={a.k} className="pill" aria-pressed={useful === a.k} onClick={() => setUseful(useful === a.k ? null : a.k)}>{a.title}</button>)}</div>
      </div>
      <div className="field"><label htmlFor="fb-wrong">Did anything feel wrong or confusing?</label><textarea id="fb-wrong" className="input" value={wrong} maxLength={2000} onChange={e => setWrong(e.target.value)} placeholder="Optional" style={{ minHeight: 110, borderRadius: 22, fontSize: 15 }} /></div>
      <div className="field"><label htmlFor="fb-wish">What do you wish GapFinder explained?</label><textarea id="fb-wish" className="input" value={wish} maxLength={2000} onChange={e => setWish(e.target.value)} placeholder="Optional" style={{ minHeight: 110, borderRadius: 22, fontSize: 15 }} /></div>
      <div className="row gap-14">
        <button className="btn btn-primary" style={{ fontSize: 16, padding: '13px 26px' }} disabled={!rating || busy} onClick={send}>{busy ? 'Sending…' : 'Send feedback'}</button>
        {!rating && <span className="small muted">Pick how helpful it was to send.</span>}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}

function FeedbackSent({ onClose, onRestart }: { onClose: () => void; onRestart: () => void }) {
  return (
    <section className="stack gap-18 mw-560" style={{ paddingTop: 40 }}>
      <span style={{ width: 64, height: 64, borderRadius: '50%', display: 'grid', placeItems: 'center', background: 'var(--color-accent-2)', color: 'var(--color-bg)' }}><Icon name="check" size={30} /></span>
      <h1 style={{ margin: 0, fontSize: 'clamp(32px,5.4vw,46px)' }}>Thanks for the feedback</h1>
      <p className="muted" style={{ margin: 0, fontSize: 17 }}>It’s saved, and it helps us make GapFinder better for the next student.</p>
      <div className="row gap-10"><button className="btn btn-secondary btn-md" onClick={onClose}>Back to my results</button><button className="btn btn-ghost" style={{ fontSize: 15 }} onClick={onRestart}>Start over</button></div>
    </section>
  );
}
