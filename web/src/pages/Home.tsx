import { Link } from 'react-router-dom';

const CARDS = [
  { stat: '13 of 28', color: 'var(--color-accent-700)', text: 'said they don’t know where to start, what colleges want, or which activities count.',
    title: 'GapFinder', body: 'Nine quick questions, then see exactly what’s missing and a first step for each gap.', to: '/gapfinder', cta: 'Try GapFinder →' },
  { stat: '26 of 28', color: 'var(--color-accent-2-700)', text: 'named a field they might want to work in, from medicine to law to marine biology.',
    title: 'Mentors', body: 'Ask a working professional in that field how they got there.', to: '/mentors', cta: 'Meet the mentors →' },
  { stat: '8 of 28', color: 'var(--color-accent-700)', text: 'said not having enough time is what’s in the way.',
    title: 'Tips', body: 'Short reads on what colleges look for, which activities are worth it, and planning your week.', to: '/tips', cta: 'Read the tips →' },
];

export function Home() {
  return (
    <main className="wrap page gap-88">
      <section className="grid auto-340" style={{ gap: 56, alignItems: 'center' }}>
        <div className="stack gap-22 mw-560" style={{ alignItems: 'flex-start' }}>
          <span className="tag tag-accent-2" style={{ fontSize: 13, padding: '5px 14px' }}>For students in grades 6–12</span>
          <h1 className="h-hero">Find the gaps in your college plan while there’s still time to fix them.</h1>
          <p className="lead" style={{ maxWidth: 500 }}>Answer nine quick questions, see what’s missing compared with what colleges look for, then talk it through with someone who works in your field.</p>
          <div className="row gap-10" style={{ marginTop: 6 }}>
            <Link to="/gapfinder" className="btn btn-primary btn-lg">Start GapFinder</Link>
            <Link to="/mentors" className="btn btn-secondary btn-lg">Meet the mentors</Link>
          </div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="blob" style={{ right: 0, top: 10, width: 360, height: 360, background: 'var(--color-accent-2-200)' }} />
          <div className="blob" style={{ left: '12%', bottom: 0, width: 120, height: 120, background: 'var(--color-accent-200)' }} />
          <div className="card elev-md" style={{ left: '4%', top: 24, width: 270, background: 'var(--color-accent-100)', border: '2px solid var(--color-accent)', transform: 'rotate(-4deg)' }}>
            <span className="tag tag-accent self-start">Gap</span>
            <div className="card-title">One activity you go deep in</div>
            <p className="card-body">Colleges look for real distinction in one activity over a long list.</p>
          </div>
          <div className="card elev-sm" style={{ right: '2%', top: 178, width: 260, background: 'var(--color-neutral-100)', transform: 'rotate(3deg)' }}>
            <span className="tag tag-accent-2 self-start">Covered</span>
            <div className="card-title">A study routine</div>
            <p className="card-body">You study a few days ahead. Keep it going.</p>
          </div>
          <div className="card elev-lg" style={{ left: '14%', top: 290, width: 280, background: 'var(--color-bg)' }}>
            <div className="card-kicker" style={{ fontSize: 11, color: 'var(--color-accent-700)' }}>Your first step</div>
            <div className="card-title" style={{ fontSize: 17 }}>Set one goal in your main activity this year.</div>
          </div>
        </div>
      </section>

      <section className="stack gap-28">
        <div className="stack gap-8 mw-620">
          <h2 style={{ margin: 0 }}>What 28 students told us</h2>
          <p className="muted" style={{ margin: 0, fontSize: 16 }}>We asked middle and high schoolers what’s getting in the way of preparing for college. Each part of the site answers one of those.</p>
        </div>
        <div className="grid auto-280" style={{ gap: 20 }}>
          {CARDS.map(c => (
            <div key={c.title} className="card" style={{ padding: 26, gap: 14 }}>
              <div className="stat" style={{ color: c.color }}>{c.stat}</div>
              <p style={{ margin: 0, fontSize: 15 }}>{c.text}</p>
              <div className="rule" />
              <div className="card-title" style={{ fontSize: 20 }}>{c.title}</div>
              <p className="card-body" style={{ fontSize: 14 }}>{c.body}</p>
              <Link to={c.to} className="btn btn-ghost self-start" style={{ fontSize: 15 }}>{c.cta}</Link>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
