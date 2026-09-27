import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { money, statusTone } from '../../lib/format.js';
import { Alert, Card, ErrorState, Eyebrow, Loading, PageHead, Stat } from '../../components/ui.jsx';
import { useSocketEvent } from '../../lib/socket.js';

/** Statuses worth a row in the pipeline view, in lifecycle order. */
const PIPELINE = [
  'PENDING_PAYMENT',
  'OPEN',
  'ASSIGNED',
  'EN_ROUTE',
  'IN_PROGRESS',
  'AWAITING_REPORT',
  'COMPLETED',
];

export default function AdminDashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setError(null);
    api.admin.overview().then(setData).catch(setError);
  }, []);

  useEffect(load, [load]);

  // The dashboard is the ops room — it should move on its own.
  useSocketEvent('job:opened', load);
  useSocketEvent('job:updated', load);
  useSocketEvent('provider:updated', load);
  useSocketEvent('exception:raised', load);

  if (error) return <ErrorState error={error} onRetry={load} />;
  if (!data) return <Loading label="Loading dashboard" />;

  const { counters, jobsByStatus, currency } = data;
  const totalJobs = Object.values(jobsByStatus).reduce((a, b) => a + b, 0);
  const live = PIPELINE.slice(0, 6).reduce((a, s) => a + (jobsByStatus[s] || 0), 0);

  return (
    <div>
      <PageHead
        eyebrow="Operations"
        title="Dashboard"
        sub="Live state of the platform. Updates on its own as jobs move."
      />

      {/* What needs a human, first and loudest. */}
      {(counters.openExceptions > 0 || counters.providersPending > 0 || counters.failedNotifications > 0) && (
        <div className="grid sm:grid-cols-3 gap-3 mb-6">
          {counters.openExceptions > 0 && (
            <Link to="/admin/exceptions" className="block">
              <Alert tone="stop" title={`${counters.openExceptions} exception${counters.openExceptions === 1 ? '' : 's'} open`}>
                Jobs that need a decision — refunds, missing reports, unfilled work.
              </Alert>
            </Link>
          )}
          {counters.providersPending > 0 && (
            <Link to="/admin/providers?status=PENDING" className="block">
              <Alert tone="hold" title={`${counters.providersPending} provider${counters.providersPending === 1 ? '' : 's'} awaiting review`}>
                Documents submitted and waiting on verification.
              </Alert>
            </Link>
          )}
          {counters.failedNotifications > 0 && (
            <Alert tone="hold" title={`${counters.failedNotifications} message${counters.failedNotifications === 1 ? '' : 's'} failed to send`}>
              Email or SMS that did not reach the recipient.
            </Alert>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Stat
          label="Revenue · 30 days"
          value={money(counters.revenue30dCents, currency)}
          sub={`${counters.paidJobs30d} paid booking${counters.paidJobs30d === 1 ? '' : 's'}`}
          tone="var(--color-go)"
        />
        <Stat
          label="Owed to providers"
          value={money(counters.payoutsPendingCents, currency)}
          sub={`${counters.payoutsPendingCount} payout${counters.payoutsPendingCount === 1 ? '' : 's'} to release`}
          tone="var(--color-hold)"
        />
        <Stat label="Jobs in flight" value={live} sub={`${totalJobs} all time`} tone="var(--color-hivis)" />
        <Stat label="Customers" value={counters.customers} sub="Registered accounts" />
      </div>

      <div className="grid md:grid-cols-2 gap-5">
        <Card>
          <div className="p-4 border-b flex items-center justify-between">
            <Eyebrow>Job pipeline</Eyebrow>
            <Link to="/admin/jobs" className="ref text-[11.5px] link">
              ALL JOBS →
            </Link>
          </div>
          <div className="p-4 space-y-2.5">
            {PIPELINE.map((s) => {
              const n = jobsByStatus[s] || 0;
              const st = statusTone(s);
              const pct = totalJobs ? Math.round((n / totalJobs) * 100) : 0;
              return (
                <Link
                  key={s}
                  to={`/admin/jobs?status=${s}`}
                  className="block group"
                >
                  <div className="flex items-center justify-between gap-3 mb-1">
                    <span className="text-[13.5px] group-hover:text-[var(--color-hivis-dark)] transition-colors">
                      {st.label}
                    </span>
                    <span className="ref text-[13px] tnum">{n}</span>
                  </div>
                  <span className="block h-1.5" style={{ background: 'var(--color-paper-2)' }}>
                    <span
                      className="block h-full transition-all"
                      style={{
                        width: `${Math.max(pct, n > 0 ? 3 : 0)}%`,
                        background: n > 0 ? 'var(--color-navy-2)' : 'transparent',
                      }}
                    />
                  </span>
                </Link>
              );
            })}
            {['CANCELLED', 'REFUNDED'].some((s) => jobsByStatus[s]) && (
              <div className="rule pt-2.5 mt-3.5 flex gap-5">
                {['CANCELLED', 'REFUNDED'].map((s) =>
                  jobsByStatus[s] ? (
                    <Link key={s} to={`/admin/jobs?status=${s}`} className="text-[13px] link">
                      {statusTone(s).label}: <span className="ref">{jobsByStatus[s]}</span>
                    </Link>
                  ) : null,
                )}
              </div>
            )}
          </div>
        </Card>

        <Card>
          <div className="p-4 border-b">
            <Eyebrow>Quick actions</Eyebrow>
          </div>
          <div className="p-4 grid gap-2.5">
            {[
              ['/admin/jobs?status=OPEN', 'Unfilled jobs', 'Paid work nobody has accepted yet'],
              ['/admin/providers?status=PENDING', 'Verify providers', 'Review licenses and insurance'],
              ['/admin/money', 'Release payouts', 'Pay providers for completed jobs'],
              ['/admin/exceptions', 'Exceptions queue', 'Refunds, no-shows, missing reports'],
              ['/admin/areas', 'Coverage & pricing', 'Open a new market or change a price'],
            ].map(([to, title, sub]) => (
              <Link
                key={to}
                to={to}
                className="flex items-center justify-between gap-3 p-3 hover:bg-[var(--color-paper-2)] transition-colors"
                style={{ border: '1px solid var(--color-rule)' }}
              >
                <span className="min-w-0">
                  <span className="block font-semibold text-[14.5px]" style={{ fontFamily: 'var(--font-display)' }}>
                    {title}
                  </span>
                  <span className="block text-[13px] text-[var(--color-ink-3)]">{sub}</span>
                </span>
                <span className="ref text-[11.5px] flex-none" style={{ color: 'var(--color-hivis)' }}>
                  →
                </span>
              </Link>
            ))}
          </div>
        </Card>
      </div>

      <p className="ref text-[11px] text-[var(--color-ink-3)] mt-5">
        DOCS AWAITING REVIEW: {counters.docsPending}
      </p>
    </div>
  );
}
