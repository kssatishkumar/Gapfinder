import { Link, useNavigate, useParams } from 'react-router-dom';
import { SHOW_MENTORS } from '../lib/features';

interface Tip { id: string; kicker: string; title: string; lead: string; points: { h: string; b: string }[]; quote: string; quoteNote: string; cta: string; to: string; source: string }

// Content from prototype/My Big Quest.dc.html, with planner-specific wording updated for the quiz.
const TIPS: Tip[] = [
  { id: 'look', kicker: 'Admissions', title: 'What colleges actually look for', lead: 'Colleges weigh a few things much more than everything else. Knowing the order tells you where your time goes furthest.', points: [
    { h: 'Grades in your core classes', b: 'This is the biggest factor by far. A steady record across all four years counts for more than one great semester.' },
    { h: 'How hard your classes are', b: 'Honors, AP or IB when you’re ready. Colleges compare you with what your school offered, not with every school.' },
    { h: 'SAT or ACT scores', b: 'Several colleges that went test-optional now require scores again. Check each school on your list.' },
    { h: 'Essays, letters and activities', b: 'These come next. Colleges look for depth: what you stuck with, and what changed because you were there.' },
  ], quote: 'What do colleges want to see in an applicant', quoteNote: 'The most common question in our survey, asked in some form by 8 students', cta: 'See how your plan stacks up', to: '/gapfinder', source: 'Based on NACAC’s Factors in the Admission Decision.' },
  { id: 'activities', kicker: 'Activities', title: 'Which activities are worth it', lead: 'There’s no list of “right” activities. What counts is how long you stayed, how far you went, and what you did with it.', points: [
    { h: 'One or two, for years', b: 'Two long commitments say more than ten clubs you joined once.' },
    { h: 'Room to grow', b: 'Look for a path from member to leader to starting something new.' },
    { h: 'Results someone else can see', b: 'A placement, a performance, a finished project, people you helped.' },
    { h: 'Middle school is for trying', b: 'Switching now is fine. Pick the thing you’d keep doing even if it didn’t go on an application.' },
  ], quote: 'It mostly just matters when you’re really good at it so that you stand out from other people.', quoteNote: 'A student, in our survey', cta: 'Find your gaps', to: '/gapfinder', source: '' },
  { id: 'time', kicker: 'Planning', title: 'Time management and study plans', lead: 'Not having enough time was the top thing in the way for students in our survey. A simple weekly plan fixes more than willpower does.', points: [
    { h: 'Plan the week on Sunday', b: 'Put fixed things in first (school, practice, family), then homework blocks, then everything else.' },
    { h: 'Review a little every day', b: 'Twenty minutes of review each day beats a three-hour cram the night before.' },
    { h: 'Choose what not to do', b: 'Your hours are limited. Saying no to one thing is how you go deep on another.' },
    { h: 'Protect your sleep', b: 'Tired studying takes longer and sticks less. Sleep is part of the plan.' },
  ], quote: 'I don’t have enough time', quoteNote: 'The most common answer to “What’s getting in the way?”', cta: 'Check your plan in GapFinder', to: '/gapfinder', source: '' },
  { id: 'projects', kicker: 'Projects', title: 'Starting a nonprofit or passion project', lead: 'Colleges care about impact and commitment, not the word “nonprofit.” A small project that runs for two years can say more than an organization that only exists on paper.', points: [
    { h: 'Start with a problem you’ve seen', b: 'Something in your school, your neighborhood, or a group you belong to.' },
    { h: 'Run it small first', b: 'One event, one student you tutor, one app that solves one thing. Then grow it.' },
    { h: 'Keep a record', b: 'Who you helped, what you learned, what you changed. That becomes your essay.' },
    { h: 'You don’t need paperwork to start', b: 'Registering an official nonprofit takes forms and an adult. Most student projects don’t need it at first.' },
  ], quote: 'How appealing is creating your own nonprofit organization?', quoteNote: 'A student, in our survey', cta: SHOW_MENTORS ? 'Talk to a nonprofit founder' : 'Find your gaps', to: SHOW_MENTORS ? '/mentors?ask=nguyen' : '/gapfinder', source: '' },
];

export function Tips() {
  const { tipId } = useParams();
  const navigate = useNavigate();
  const tip = TIPS.find(t => t.id === tipId) || TIPS[0];

  return (
    <main className="wrap page grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: 48 }}>
      <aside className="stack gap-18" style={{ maxWidth: 360 }}>
        <h1 className="h-page">Tips</h1>
        <p className="muted" style={{ margin: 0, fontSize: 16 }}>Short answers to the questions students asked most in our survey.</p>
        <nav className="stack gap-8" aria-label="Tips">
          {TIPS.map((t, i) => (
            <button key={t.id} className="tip-nav" aria-current={t.id === tip.id} onClick={() => navigate('/tips/' + t.id, { replace: true })}>
              <span className="tip-num">{i + 1}</span>{t.title}
            </button>
          ))}
        </nav>
      </aside>
      <article className="stack gap-22 tips-article" style={{ maxWidth: 680 }}>
        <div className="card-kicker kicker">{tip.kicker}</div>
        <h2 style={{ margin: 0, fontSize: 'clamp(30px,3.6vw,40px)', textWrap: 'balance' }}>{tip.title}</h2>
        <p style={{ margin: 0, fontSize: 18, color: 'var(--color-neutral-900)' }}>{tip.lead}</p>
        <ol className="stack gap-10" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {tip.points.map((p, i) => (
            <li key={p.h} className="point">
              <span className="point-n">{i + 1}</span>
              <div className="stack" style={{ gap: 4 }}><span style={{ fontWeight: 700, fontSize: 16 }}>{p.h}</span><span style={{ fontSize: 15, color: 'var(--color-neutral-900)' }}>{p.b}</span></div>
            </li>
          ))}
        </ol>
        <figure className="quote">
          <blockquote>“{tip.quote}”</blockquote>
          <figcaption className="small" style={{ color: 'var(--color-accent-2-800)' }}>{tip.quoteNote}</figcaption>
        </figure>
        <div className="row gap-10">
          <Link to={tip.to} className="btn btn-primary btn-md">{tip.cta}</Link>
          {tip.source && <span className="tiny" style={{ color: 'var(--color-neutral-700)' }}>{tip.source}</span>}
        </div>
      </article>
    </main>
  );
}
