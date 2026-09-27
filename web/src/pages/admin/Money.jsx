import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import {
  dateTimeFull,
  money,
  moneyExact,
  titleCase,
  PAYMENT_TONE,
  PAYOUT_TONE,
} from '../../lib/format.js';
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmButton,
  Empty,
  ErrorState,
  Eyebrow,
  Loading,
  PageHead,
  Select,
  Stat,
} from '../../components/ui.jsx';

export default function AdminMoney() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'payouts' ? 'payouts' : 'payments';

  const setTab = (t) => setParams(new URLSearchParams({ tab: t }));

  return (
    <div>
      <PageHead
        eyebrow="Finance"
        title="Money"
        sub="What came in from customers, and what goes out to providers."
      />

      <div className="flex gap-2 mb-5">
        {[
          ['payments', 'Payments in'],
          ['payouts', 'Payouts out'],
        ].map(([v, label]) => (
          <button key={v} onClick={() => setTab(v)} className={`chip px-3.5 ${tab === v ? 'chip-on' : ''}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'payments' ? <Payments /> : <Payouts />}
    </div>
  );
}

/* ------------------------------------------------------------- payments in */

function Payments() {
  const [status, setStatus] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setError(null);
    api.admin.payments({ status: status || undefined, perPage: 50 }).then(setData).catch(setError);
  }, [status]);

  useEffect(() => {
    setData(null);
    load();
  }, [load]);

  if (error) return <ErrorState error={error} onRetry={load} />;
  if (!data) return <Loading label="Loading payments" />;

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-5">
        <Stat
          label="Collected"
          value={money(data.totals.collectedCents, data.currency)}
          sub="All successful payments"
          tone="var(--color-go)"
        />
        <Stat
          label="Refunded"
          value={money(data.totals.refundedCents, data.currency)}
          sub="Returned to customers"
          tone="var(--color-stop)"
        />
        <Stat
          label="Net"
          value={money(data.totals.collectedCents - data.totals.refundedCents, data.currency)}
          sub="Collected less refunds"
        />
      </div>

      <div className="flex gap-2.5 mb-4">
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="sm:w-56">
          <option value="">All payments</option>
          {['REQUIRES_PAYMENT', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'REFUNDED'].map((s) => (
            <option key={s} value={s}>
              {titleCase(s)}
            </option>
          ))}
        </Select>
      </div>

      <Card>
        {data.payments.length === 0 ? (
          <Empty title="No payments match that" />
        ) : (
          <div className="table-scroll">
            <table className="dtable">
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Customer</th>
                  <th>Status</th>
                  <th>Paid</th>
                  <th className="text-right">Amount</th>
                  <th className="text-right">Refunded</th>
                </tr>
              </thead>
              <tbody>
                {data.payments.map((p) => (
                  <tr key={p.id}>
                    <td className="whitespace-nowrap">
                      <Link to={`/admin/jobs/${p.job.id}`} className="ref text-[12.5px] link">
                        {p.job.reference}
                      </Link>
                      <span className="block text-[12px] text-[var(--color-ink-3)]">
                        {p.job.service.name}
                      </span>
                    </td>
                    <td>
                      <span className="block">{p.job.customer.fullName}</span>
                      <span className="block text-[12px] text-[var(--color-ink-3)]">
                        {p.job.customer.email}
                      </span>
                    </td>
                    <td>
                      <Badge tone={PAYMENT_TONE[p.status]}>{titleCase(p.status)}</Badge>
                      {p.failureReason && (
                        <span className="block text-[12px] text-[var(--color-stop)] mt-1 max-w-[200px]">
                          {p.failureReason}
                        </span>
                      )}
                    </td>
                    <td className="ref text-[12px] text-[var(--color-ink-3)] whitespace-nowrap">
                      {p.paidAt ? dateTimeFull(p.paidAt) : '—'}
                    </td>
                    <td className="text-right ref whitespace-nowrap">
                      {moneyExact(p.amountCents, p.currency)}
                    </td>
                    <td className="text-right ref whitespace-nowrap">
                      {p.refundedCents > 0 ? (
                        <span style={{ color: 'var(--color-stop)' }}>
                          {moneyExact(p.refundedCents, p.currency)}
                        </span>
                      ) : (
                        <span className="text-[var(--color-ink-3)]">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="text-[13px] text-[var(--color-ink-3)] mt-4">
        Refunds are issued from the job page, so the reason is recorded against the booking.
      </p>
    </>
  );
}

/* ------------------------------------------------------------ payouts out */

function Payouts() {
  const [status, setStatus] = useState('PENDING');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [sending, setSending] = useState(null);

  const load = useCallback(() => {
    setError(null);
    api.admin.payouts({ status: status || undefined, perPage: 50 }).then(setData).catch(setError);
  }, [status]);

  useEffect(() => {
    setData(null);
    load();
  }, [load]);

  const send = async (p) => {
    setSending(p.id);
    setError(null);
    try {
      await api.admin.sendPayout(p.id);
      setNotice(`Sent ${moneyExact(p.amountCents, p.currency)} to ${p.provider.businessName}.`);
      load();
    } catch (e) {
      setError(e);
    } finally {
      setSending(null);
    }
  };

  if (error && !data) return <ErrorState error={error} onRetry={load} />;
  if (!data) return <Loading label="Loading payouts" />;

  const pendingTotal = data.payouts
    .filter((p) => p.status === 'PENDING')
    .reduce((a, p) => a + p.amountCents, 0);

  return (
    <>
      {notice && (
        <Alert tone="go" className="mb-5">
          {notice}
        </Alert>
      )}
      {error && (
        <Alert tone="stop" className="mb-5">
          {error.message}
        </Alert>
      )}

      <div className="flex flex-wrap items-center gap-2.5 mb-4">
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="sm:w-56">
          <option value="">All payouts</option>
          {['PENDING', 'PROCESSING', 'PAID', 'FAILED'].map((s) => (
            <option key={s} value={s}>
              {titleCase(s)}
            </option>
          ))}
        </Select>

        {status === 'PENDING' && pendingTotal > 0 && (
          <p className="ref text-[12.5px] text-[var(--color-ink-3)]">
            {moneyExact(pendingTotal, data.currency)} OWED ACROSS {data.payouts.length} JOB
            {data.payouts.length === 1 ? '' : 'S'}
          </p>
        )}
      </div>

      <Card>
        {data.payouts.length === 0 ? (
          <Empty title={status === 'PENDING' ? 'Nothing owed right now' : 'No payouts match that'}>
            {status === 'PENDING'
              ? 'A payout appears here once a job is complete and any required report is on file.'
              : null}
          </Empty>
        ) : (
          <div className="table-scroll">
            <table className="dtable">
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Provider</th>
                  <th>Completed</th>
                  <th>Status</th>
                  <th className="text-right">Amount</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.payouts.map((p) => (
                  <tr key={p.id}>
                    <td className="whitespace-nowrap">
                      <Link to={`/admin/jobs/${p.job.id}`} className="ref text-[12.5px] link">
                        {p.job.reference}
                      </Link>
                      <span className="block text-[12px] text-[var(--color-ink-3)]">
                        {p.job.service.name}
                      </span>
                    </td>
                    <td>
                      <Link to={`/admin/providers/${p.provider.id}`} className="link">
                        {p.provider.businessName}
                      </Link>
                      {!p.provider.payoutRef && (
                        <span className="block text-[12px]" style={{ color: 'var(--color-hold)' }}>
                          no payout account connected
                        </span>
                      )}
                    </td>
                    <td className="ref text-[12px] text-[var(--color-ink-3)] whitespace-nowrap">
                      {p.job.completedAt ? dateTimeFull(p.job.completedAt) : '—'}
                    </td>
                    <td>
                      <Badge tone={PAYOUT_TONE[p.status]}>{titleCase(p.status)}</Badge>
                      {p.failureReason && (
                        <span className="block text-[12px] text-[var(--color-stop)] mt-1 max-w-[200px]">
                          {p.failureReason}
                        </span>
                      )}
                    </td>
                    <td className="text-right ref whitespace-nowrap">
                      {moneyExact(p.amountCents, p.currency)}
                    </td>
                    <td className="text-right">
                      {['PENDING', 'FAILED'].includes(p.status) && (
                        <ConfirmButton
                          variant="primary"
                          size="sm"
                          title={`Send ${moneyExact(p.amountCents, p.currency)}?`}
                          body={`This releases payment to ${p.provider.businessName} for job ${p.job.reference}. It cannot be undone from here.`}
                          confirmLabel={sending === p.id ? 'Sending…' : 'Send payment'}
                          onConfirm={() => send(p)}
                        >
                          {p.status === 'FAILED' ? 'Retry' : 'Send'}
                        </ConfirmButton>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
