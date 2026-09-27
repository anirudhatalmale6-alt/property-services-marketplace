import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { dateTimeFull, money, statusTone } from '../lib/format.js';
import { Badge, Button, Card, Empty, ErrorState, Loading, PageHead } from '../components/ui.jsx';
import { useSocketEvent } from '../lib/socket.js';

const SCOPES = [
  ['all', 'All'],
  ['active', 'In progress'],
  ['past', 'Finished'],
];

export default function Orders() {
  const [scope, setScope] = useState('all');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const load = (s = scope) => {
    setError(null);
    api.bookings.list(s === 'all' ? undefined : s).then(setData).catch(setError);
  };

  useEffect(() => {
    setData(null);
    load(scope);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  // A status change pushed from the server refreshes the list in place.
  useSocketEvent('job:updated', () => load());

  return (
    <div>
      <PageHead
        eyebrow="Your account"
        title="My bookings"
        sub="Every job you've booked, with its live status and any reports filed against it."
        actions={
          <Link to="/book" className="btn btn-primary btn-sm">
            Book a service
          </Link>
        }
      />

      <div className="flex gap-2 mb-5">
        {SCOPES.map(([v, label]) => (
          <button
            key={v}
            onClick={() => setScope(v)}
            className={`chip px-3 ${scope === v ? 'chip-on' : ''}`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <ErrorState error={error} onRetry={() => load()} />}
      {!data && !error && <Loading label="Loading your bookings" />}

      {data && data.jobs.length === 0 && (
        <Card className="p-2">
          <Empty
            title="Nothing here yet"
            action={
              <Link to="/book" className="btn btn-primary">
                Book your first service
              </Link>
            }
          >
            When you book a service it will appear here, and you&apos;ll be able to follow it from
            payment through to the finished report.
          </Empty>
        </Card>
      )}

      {data && data.jobs.length > 0 && (
        <div className="space-y-3">
          {data.jobs.map((j, i) => {
            const st = statusTone(j.status);
            return (
              <Link
                key={j.id}
                to={`/orders/${j.id}`}
                className="block surface p-4 rise hover:border-[var(--color-ink-3)] transition-colors"
                style={{ borderLeft: '3px solid var(--color-rule-strong)', animationDelay: `${i * 45}ms` }}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2.5 flex-wrap mb-1">
                      <span className="ref text-[12.5px] text-[var(--color-ink-3)]">{j.reference}</span>
                      <Badge tone={st.tone}>{st.label}</Badge>
                    </div>
                    <h3 className="text-[17px] leading-snug">{j.service.name}</h3>
                    <p className="text-[14px] text-[var(--color-ink-2)] mt-0.5">
                      {dateTimeFull(j.scheduledStart)}
                    </p>
                    <p className="text-[13.5px] text-[var(--color-ink-3)]">
                      {[j.address.line1, j.address.city, j.address.zip].filter(Boolean).join(', ')}
                      {j.provider && ` · ${j.provider.businessName}`}
                    </p>
                  </div>

                  <div className="text-right flex-none">
                    <p
                      className="text-[19px] leading-none tnum"
                      style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}
                    >
                      {money(j.payment?.amountCents ?? j.priceCents, data.currency)}
                    </p>
                    <p className="ref text-[11px] text-[var(--color-ink-3)] mt-1.5">Details →</p>
                  </div>
                </div>

                {/* The one thing they need to do, surfaced on the card. */}
                {j.status === 'PENDING_PAYMENT' && (
                  <p className="mt-3 rule pt-2.5 text-[13.5px]" style={{ color: 'var(--color-hold)' }}>
                    Payment not completed — open this booking to finish checkout.
                  </p>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
