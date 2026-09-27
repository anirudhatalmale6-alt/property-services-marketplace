import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { addressLine, dateTimeFull, money, relative, statusTone } from '../../lib/format.js';
import { Badge, Card, Empty, ErrorState, Loading, PageHead } from '../../components/ui.jsx';
import { useSocketEvent } from '../../lib/socket.js';

const SCOPES = [
  ['active', 'Upcoming'],
  ['past', 'Finished'],
  ['all', 'All'],
];

export default function MyJobs() {
  const [scope, setScope] = useState('active');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(
    (s) => {
      setError(null);
      api.provider.mine(s).then(setData).catch(setError);
    },
    [],
  );

  useEffect(() => {
    setData(null);
    load(scope);
  }, [scope, load]);

  useSocketEvent('job:updated', () => load(scope));

  return (
    <div>
      <PageHead
        eyebrow="Your work"
        title="My jobs"
        sub="Everything you've accepted, with the address and contact details you need on site."
      />

      <div className="flex gap-2 mb-5">
        {SCOPES.map(([v, label]) => (
          <button key={v} onClick={() => setScope(v)} className={`chip px-3 ${scope === v ? 'chip-on' : ''}`}>
            {label}
          </button>
        ))}
      </div>

      {error && <ErrorState error={error} onRetry={() => load(scope)} />}
      {!data && !error && <Loading label="Loading your jobs" />}

      {data && data.jobs.length === 0 && (
        <Card className="p-2">
          <Empty
            title={scope === 'active' ? 'No jobs booked in' : 'Nothing here'}
            action={
              scope === 'active' ? (
                <Link to="/provider/jobs" className="btn btn-primary">
                  See the job board
                </Link>
              ) : null
            }
          >
            {scope === 'active'
              ? 'Accept a job from the board and it will show up here with the full address and the customer’s number.'
              : 'Jobs you have completed or that were cancelled will be listed here.'}
          </Empty>
        </Card>
      )}

      <div className="space-y-3">
        {data?.jobs.map((j, i) => {
          const st = statusTone(j.status);
          return (
            <Link
              key={j.id}
              to={`/provider/jobs/${j.id}`}
              className="block surface p-4 rise hover:border-[var(--color-ink-3)] transition-colors"
              style={{ borderLeft: '3px solid var(--color-rule-strong)', animationDelay: `${i * 40}ms` }}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="ref text-[12px] text-[var(--color-ink-3)]">{j.reference}</span>
                    <Badge tone={st.tone}>{st.label}</Badge>
                    {j.payout && (
                      <Badge tone={j.payout.status === 'PAID' ? 'badge-go' : 'badge-hold'}>
                        {j.payout.status === 'PAID' ? 'Paid' : 'Payment pending'}
                      </Badge>
                    )}
                  </div>

                  <h3 className="text-[17px] leading-snug">{j.service.name}</h3>
                  <p className="text-[14px] text-[var(--color-ink-2)] mt-0.5">
                    {dateTimeFull(j.scheduledStart)}{' '}
                    <span className="text-[var(--color-ink-3)]">({relative(j.scheduledStart)})</span>
                  </p>
                  <p className="text-[13.5px] text-[var(--color-ink-3)]">{addressLine(j.address)}</p>
                </div>

                <div className="text-right flex-none">
                  <p
                    className="text-[19px] leading-none tnum"
                    style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}
                  >
                    {money(j.providerPayCents, data.currency)}
                  </p>
                  <p className="ref text-[11px] text-[var(--color-ink-3)] mt-1.5">Open →</p>
                </div>
              </div>

              {j.status === 'AWAITING_REPORT' && (
                <p className="mt-3 rule pt-2.5 text-[13.5px]" style={{ color: 'var(--color-hold)' }}>
                  Report outstanding — your payment is held until it&apos;s uploaded.
                </p>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
