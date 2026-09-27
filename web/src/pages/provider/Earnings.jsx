import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { dateTimeFull, money, moneyExact, titleCase } from '../../lib/format.js';
import { Alert, Badge, Card, Empty, ErrorState, Eyebrow, Loading, PageHead, Stat } from '../../components/ui.jsx';
import { PAYOUT_TONE } from '../../lib/format.js';

export default function Earnings() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const load = () => {
    setError(null);
    api.provider.earnings().then(setData).catch(setError);
  };
  useEffect(load, []);

  if (error) return <ErrorState error={error} onRetry={load} />;
  if (!data) return <Loading label="Loading earnings" />;

  const { summary, payouts, currency } = data;
  const failed = payouts.filter((p) => p.status === 'FAILED');

  return (
    <div>
      <PageHead
        eyebrow="Money"
        title="Earnings"
        sub="What you're owed, what's been sent, and the job each payment belongs to."
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Stat
          label="Awaiting payment"
          value={money(summary.pendingCents, currency)}
          sub={`${summary.pendingCount} job${summary.pendingCount === 1 ? '' : 's'} complete`}
          tone="var(--color-hold)"
        />
        <Stat
          label="Paid to date"
          value={money(summary.paidCents, currency)}
          sub={`${summary.paidCount} payment${summary.paidCount === 1 ? '' : 's'}`}
          tone="var(--color-go)"
        />
        <Stat label="Jobs booked in" value={summary.upcomingJobs} sub="Accepted, not yet finished" />
        <Stat
          label="Lifetime"
          value={money(summary.paidCents + summary.pendingCents, currency)}
          sub="Paid plus pending"
          tone="var(--color-hivis)"
        />
      </div>

      {failed.length > 0 && (
        <Alert tone="stop" className="mb-5" title="A payment didn't go through">
          {failed.length === 1 ? 'One payment' : `${failed.length} payments`} failed to send. Our team
          has been alerted automatically and will sort out your bank details — you don&apos;t need to
          chase it, and nothing is lost.
        </Alert>
      )}

      <Card>
        <div className="p-4 border-b">
          <Eyebrow>Payment history</Eyebrow>
        </div>

        {payouts.length === 0 ? (
          <Empty title="No payments yet">
            Finish your first job — and upload its report if one is required — and your payment will
            appear here.
          </Empty>
        ) : (
          <div className="table-scroll">
            <table className="dtable">
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Service</th>
                  <th>Completed</th>
                  <th>Status</th>
                  <th className="text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {payouts.map((p) => (
                  <tr key={p.id}>
                    <td className="ref text-[12.5px] whitespace-nowrap">{p.job.reference}</td>
                    <td>{p.job.service.name}</td>
                    <td className="ref text-[12px] text-[var(--color-ink-3)] whitespace-nowrap">
                      {p.job.completedAt ? dateTimeFull(p.job.completedAt) : '—'}
                    </td>
                    <td>
                      <Badge tone={PAYOUT_TONE[p.status]}>{titleCase(p.status)}</Badge>
                      {p.failureReason && (
                        <span className="block text-[12px] text-[var(--color-stop)] mt-1 max-w-[220px]">
                          {p.failureReason}
                        </span>
                      )}
                    </td>
                    <td className="text-right ref whitespace-nowrap">
                      {moneyExact(p.amountCents, currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="text-[13px] text-[var(--color-ink-3)] mt-4">
        Payments are released once a job is complete and any required report is on file. They
        normally land in your account within 1–2 business days of being sent.
      </p>
    </div>
  );
}
