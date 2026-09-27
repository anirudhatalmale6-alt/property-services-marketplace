import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { dateTimeFull, money, statusTone, titleCase, PAYMENT_TONE } from '../../lib/format.js';
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorState,
  Eyebrow,
  Input,
  Loading,
  PageHead,
  Select,
} from '../../components/ui.jsx';
import { useSocketEvent } from '../../lib/socket.js';

const STATUSES = [
  'PENDING_PAYMENT',
  'OPEN',
  'ASSIGNED',
  'EN_ROUTE',
  'IN_PROGRESS',
  'AWAITING_REPORT',
  'COMPLETED',
  'CANCELLED',
  'REFUNDED',
];

export default function AdminJobs() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') || '';
  const q = params.get('q') || '';
  const page = Number(params.get('page') || 1);

  const [search, setSearch] = useState(q);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setError(null);
    api.admin.jobs({ status: status || undefined, q: q || undefined, page, perPage: 25 })
      .then(setData)
      .catch(setError);
  }, [status, q, page]);

  useEffect(() => {
    setData(null);
    load();
  }, [load]);

  useSocketEvent('job:updated', load);
  useSocketEvent('job:opened', load);

  const setParam = (k, v) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    if (k !== 'page') next.delete('page');
    setParams(next);
  };

  const pages = data ? Math.max(1, Math.ceil(data.total / data.perPage)) : 1;

  return (
    <div>
      <PageHead
        eyebrow="Operations"
        title="Jobs"
        sub="Every booking on the platform, with its payment and assignment state."
      />

      <div className="flex flex-wrap gap-2.5 mb-5">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setParam('q', search.trim());
          }}
          className="flex gap-2 flex-1 min-w-[240px]"
        >
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Reference, customer name, email or postcode"
            className="flex-1"
          />
          <Button type="submit" variant="ink">
            Search
          </Button>
        </form>

        <Select value={status} onChange={(e) => setParam('status', e.target.value)} className="sm:w-56">
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {statusTone(s).label}
            </option>
          ))}
        </Select>

        {(status || q) && (
          <Button
            variant="quiet"
            onClick={() => {
              setSearch('');
              setParams(new URLSearchParams());
            }}
          >
            Clear
          </Button>
        )}
      </div>

      {error && <ErrorState error={error} onRetry={load} />}
      {!data && !error && <Loading label="Loading jobs" />}

      {data && (
        <>
          <p className="ref text-[11.5px] text-[var(--color-ink-3)] mb-2.5">
            {data.total} JOB{data.total === 1 ? '' : 'S'}
            {status && ` · ${statusTone(status).label.toUpperCase()}`}
          </p>

          <Card>
            {data.jobs.length === 0 ? (
              <Empty title="No jobs match that">Try clearing the filters.</Empty>
            ) : (
              <div className="table-scroll">
                <table className="dtable">
                  <thead>
                    <tr>
                      <th>Ref</th>
                      <th>Service</th>
                      <th>Customer</th>
                      <th>When</th>
                      <th>Provider</th>
                      <th>Status</th>
                      <th>Payment</th>
                      <th className="text-right">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.jobs.map((j) => {
                      const st = statusTone(j.status);
                      return (
                        <tr key={j.id}>
                          <td className="whitespace-nowrap">
                            <Link to={`/admin/jobs/${j.id}`} className="ref text-[12.5px] link">
                              {j.reference}
                            </Link>
                            {j._count?.exceptions > 0 && (
                              <span className="badge badge-stop ml-1.5">{j._count.exceptions}</span>
                            )}
                          </td>
                          <td>{j.service.name}</td>
                          <td>
                            <span className="block">{j.customer.fullName}</span>
                            <span className="block text-[12px] text-[var(--color-ink-3)]">
                              {j.customer.email}
                            </span>
                          </td>
                          <td className="ref text-[12px] whitespace-nowrap">
                            {dateTimeFull(j.scheduledStart)}
                            <span className="block text-[var(--color-ink-3)]">
                              {j.address.city} {j.address.postcode}
                            </span>
                          </td>
                          <td>
                            {j.provider ? (
                              j.provider.businessName
                            ) : (
                              <span className="text-[var(--color-ink-3)]">—</span>
                            )}
                          </td>
                          <td>
                            <Badge tone={st.tone}>{st.label}</Badge>
                          </td>
                          <td>
                            {j.payment ? (
                              <Badge tone={PAYMENT_TONE[j.payment.status]}>
                                {titleCase(j.payment.status)}
                              </Badge>
                            ) : (
                              <span className="text-[var(--color-ink-3)]">—</span>
                            )}
                          </td>
                          <td className="text-right ref whitespace-nowrap">
                            {money(j.priceCents, data.currency)}
                            <span className="block text-[11.5px] text-[var(--color-ink-3)]">
                              pays {money(j.providerPayCents, data.currency)}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {pages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setParam('page', String(page - 1))}
              >
                ← Previous
              </Button>
              <span className="ref text-[12px] text-[var(--color-ink-3)]">
                PAGE {page} OF {pages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= pages}
                onClick={() => setParam('page', String(page + 1))}
              >
                Next →
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
