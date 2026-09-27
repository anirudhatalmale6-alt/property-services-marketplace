import { useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth, homeFor } from '../lib/auth.jsx';
import { closeSocket } from '../lib/socket.js';
import { Button } from './ui.jsx';

const cx = (...p) => p.filter(Boolean).join(' ');

/** The drawing-sheet mark used as the logo. */
function Mark({ size = 26 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" aria-hidden="true" className="flex-none">
      <rect x="1.5" y="1.5" width="23" height="23" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M1.5 8.5h23M8.5 1.5v23" stroke="currentColor" strokeWidth="1" opacity=".45" />
      <path d="M13 12.5l6 4.5v5.5h-12V17z" fill="var(--color-hivis)" />
    </svg>
  );
}

function navFor(user) {
  if (!user) {
    return [
      { to: '/', label: 'Home', end: true },
      { to: '/book', label: 'Book a service' },
    ];
  }
  if (user.role === 'ADMIN') {
    return [
      { to: '/admin', label: 'Dashboard', end: true },
      { to: '/admin/jobs', label: 'Jobs' },
      { to: '/admin/providers', label: 'Providers' },
      { to: '/admin/customers', label: 'Customers' },
      { to: '/admin/money', label: 'Money' },
      { to: '/admin/exceptions', label: 'Exceptions' },
      { to: '/admin/areas', label: 'Coverage' },
    ];
  }
  if (user.role === 'PROVIDER') {
    const approved = user.provider?.status === 'APPROVED';
    return approved
      ? [
          // `end` matters: a job detail lives at /provider/jobs/:id, which
          // would otherwise prefix-match and light up "Job board" while the
          // user is actually looking at one of their own accepted jobs.
          { to: '/provider/jobs', label: 'Job board', end: true },
          { to: '/provider/mine', label: 'My jobs' },
          { to: '/provider/earnings', label: 'Earnings' },
        ]
      : [{ to: '/provider/onboarding', label: 'Get approved' }];
  }
  return [
    { to: '/book', label: 'Book a service' },
    { to: '/orders', label: 'My bookings' },
  ];
}

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  const links = navFor(user);
  const isProviderPortal = user?.role === 'PROVIDER' && user.provider?.status === 'APPROVED';

  const signOut = async () => {
    await logout();
    closeSocket();
    navigate('/');
    setMenuOpen(false);
  };

  return (
    <div className="min-h-dvh flex flex-col">
      {/* --------------------------------------------------------- header */}
      <header style={{ background: 'var(--color-navy)' }} className="text-white">
        <div className="mx-auto max-w-6xl px-4">
          <div className="flex items-center justify-between gap-4 h-16">
            <Link to={homeFor(user)} className="flex items-center gap-2.5 text-white min-w-0">
              <Mark />
              <span className="min-w-0">
                <span
                  className="block text-[15px] leading-tight truncate"
                  style={{ fontFamily: 'var(--font-display)', fontWeight: 700, letterSpacing: '-.02em' }}
                >
                  Home Inspection
                </span>
                <span
                  className="block text-[9.5px] tracking-[.18em] uppercase"
                  style={{ fontFamily: 'var(--font-mono)', color: 'rgba(255,255,255,.5)' }}
                >
                  Licensed inspectors, nationwide
                </span>
              </span>
            </Link>

            {/* Desktop nav */}
            <nav className="hidden md:flex items-center gap-5">
              {links.map((l) => (
                <NavLink
                  key={l.to}
                  to={l.to}
                  end={l.end}
                  className={({ isActive }) => cx('navlink', isActive && 'navlink-active')}
                >
                  {l.label}
                </NavLink>
              ))}
            </nav>

            <div className="flex items-center gap-2">
              {user ? (
                <div className="hidden md:flex items-center gap-3">
                  <span className="text-right leading-tight">
                    <span className="block text-[13px] font-semibold">{user.fullName}</span>
                    <span
                      className="block text-[10px] tracking-[.12em] uppercase"
                      style={{ fontFamily: 'var(--font-mono)', color: 'rgba(255,255,255,.55)' }}
                    >
                      {user.role === 'PROVIDER' && user.provider?.status !== 'APPROVED'
                        ? `Provider · ${user.provider?.status?.toLowerCase()}`
                        : user.role.toLowerCase()}
                    </span>
                  </span>
                  <button
                    onClick={signOut}
                    className="btn btn-sm"
                    style={{ background: 'rgba(255,255,255,.12)', color: '#fff' }}
                  >
                    Sign out
                  </button>
                </div>
              ) : (
                <div className="hidden md:flex items-center gap-2">
                  <Link
                    to="/login"
                    className="btn btn-sm"
                    style={{ background: 'rgba(255,255,255,.12)', color: '#fff' }}
                  >
                    Sign in
                  </Link>
                  <Link to="/book" className="btn btn-sm btn-primary">
                    Book now
                  </Link>
                </div>
              )}

              <button
                className="md:hidden btn btn-sm"
                style={{ background: 'rgba(255,255,255,.12)', color: '#fff' }}
                onClick={() => setMenuOpen((v) => !v)}
                aria-expanded={menuOpen}
                aria-label="Menu"
              >
                {menuOpen ? '✕' : '☰'}
              </button>
            </div>
          </div>
        </div>

        {/* Mobile menu */}
        {menuOpen && (
          <div className="md:hidden border-t border-white/10 pb-3 rise">
            <nav className="mx-auto max-w-6xl px-4 flex flex-col">
              {links.map((l) => (
                <NavLink
                  key={l.to}
                  to={l.to}
                  end={l.end}
                  onClick={() => setMenuOpen(false)}
                  className={({ isActive }) =>
                    cx(
                      'py-3 border-b border-white/10 text-[15px] font-semibold',
                      isActive ? 'text-white' : 'text-white/70',
                    )
                  }
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  {l.label}
                </NavLink>
              ))}
              <div className="pt-3">
                {user ? (
                  <>
                    <p className="text-[13px] text-white/60 mb-2">
                      Signed in as {user.fullName}
                    </p>
                    <Button variant="primary" className="w-full" onClick={signOut}>
                      Sign out
                    </Button>
                  </>
                ) : (
                  <div className="flex flex-col gap-2">
                    <Link to="/login" onClick={() => setMenuOpen(false)} className="btn btn-outline w-full" style={{ color: '#fff', borderColor: 'rgba(255,255,255,.3)' }}>
                      Sign in
                    </Link>
                    <Link to="/book" onClick={() => setMenuOpen(false)} className="btn btn-primary w-full">
                      Book a service
                    </Link>
                  </div>
                )}
              </div>
            </nav>
          </div>
        )}
      </header>

      {/* Provider pending-approval banner, on every page until resolved. */}
      {user?.role === 'PROVIDER' && user.provider?.status !== 'APPROVED' && (
        <div
          className="text-[13.5px] px-4 py-2 text-center"
          style={{ background: 'var(--color-hold-wash)', borderBottom: '1px solid var(--color-rule)' }}
        >
          {user.provider?.status === 'PENDING'
            ? 'Your application is with our team for review — we’ll email you as soon as it’s approved.'
            : user.provider?.status === 'REJECTED'
              ? 'Your application was not approved. Check your onboarding page for the reason.'
              : 'Finish your onboarding to start receiving jobs.'}
        </div>
      )}

      {/* ----------------------------------------------------------- main */}
      <main className={cx('flex-1 mx-auto w-full max-w-6xl px-4 py-7', isProviderPortal && 'pb-24 md:pb-7')}>
        <Outlet />
      </main>

      {/* ---------------------------------------------------------- footer */}
      <footer className="border-t mt-4" style={{ background: 'var(--color-paper-2)' }}>
        <div className="mx-auto max-w-6xl px-4 py-6 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[13px] text-[var(--color-ink-3)]">
            Licensed &amp; insured inspectors · Fixed prices · Reports you can rely on
          </p>
          <p className="ref text-[11px] text-[var(--color-ink-3)]">MVP BUILD · PHASE 1</p>
        </div>
      </footer>

      {/* Provider bottom tab bar — the portal is used one-handed on site. */}
      {isProviderPortal && (
        <nav
          className="md:hidden fixed bottom-0 left-0 right-0 z-40 flex border-t"
          style={{ background: 'var(--color-surface)' }}
        >
          {[
            { to: '/provider/jobs', label: 'Board', icon: '◫', end: true },
            { to: '/provider/mine', label: 'My jobs', icon: '☰' },
            { to: '/provider/earnings', label: 'Earnings', icon: '$' },
          ].map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) => cx('tabbar-link', isActive && 'tabbar-link-active')}
            >
              <span className="text-lg leading-none" aria-hidden="true">
                {t.icon}
              </span>
              {t.label}
            </NavLink>
          ))}
        </nav>
      )}

      {/* Keep the route in the DOM for tests to assert against. */}
      <span hidden data-route={location.pathname} />
    </div>
  );
}
