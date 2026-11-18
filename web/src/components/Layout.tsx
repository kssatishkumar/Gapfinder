import { useEffect } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';

export function Layout() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);

  return (
    <div className="shell">
      <header className="wrap">
        <nav className="nav topnav">
          <Link to="/" className="nav-brand brand"><span className="brand-dot" /><span>My Big Quest</span></Link>
          <NavLink to="/gapfinder">GapFinder</NavLink>
          <NavLink to="/mentors">Mentors</NavLink>
          <NavLink to="/tips">Tips</NavLink>
        </nav>
      </header>
      <Outlet />
      <footer className="wrap footer">
        <span style={{ fontFamily: 'var(--font-heading)', fontSize: 16, color: 'var(--color-text)' }}>My Big Quest</span>
        {pathname === '/' && <span>Built from a survey of 28 students in grades 7–9.</span>}
        <span className="footer-note">No sign-up. Quiz answers are stored without your name.</span>
      </footer>
    </div>
  );
}
