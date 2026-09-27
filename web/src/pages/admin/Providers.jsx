import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { dateTimeFull, titleCase, PROVIDER_TONE } from '../../lib/format.js';
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorState,
  Input,
  Loading,
  PageHead,
  Select,
} from '../../components/ui.jsx';
import { useSocketEvent } from '../../lib/socket.js';

const STATUSES = ['DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED'];

export default function AdminProviders() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') || '';
  const q = params.get('q') || '';

  const [search, setSearch] = useState(q);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setError(null);
    api.admin
      .providers({ status: status || undefined, q: q || undefined, perPage: 50 })
      .then(setData)
      .catch(setError);
  }, [status, q]);

  useEffect(() => {
    setData(null);
    load();
  }, [load]);

  useSocketEvent('provider:updated', load);

  const setParam = (k, v) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next);
  };

  return (
    <div>
      <PageHead
        eyebrow="Supply"
        title="Providers"
        sub="Verify licences and insurance, then approve. Only approved providers can see or accept work."
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
            placeholder="Business name, contact or email"
            className="flex-1"
          />
          <Button type="submit" variant="ink">
            Search
          </Button>
        </form>

        <Select value={status} onChange={(e) => setParam('status', e.target.value)} className="sm:w-52">
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {titleCase(s)}
            </option>
          ))}
        </Select>
      </div>

      {/* Quick filter to the queue that actually needs attention. */}
      <div className="flex gap-2 mb-5">
        {[
          ['', 'All'],
          ['PENDING', 'Awaiting review'],
          ['APPROVED', 'Approved'],
          ['REJECTED', 'Rejected'],
        ].map(([v, label]) => (
          <button
            key={v || 'all'}
            onClick={() => setParam('status', v)}
            className={`chip px-3 ${status === v ? 'chip-on' : ''}`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <ErrorState error={error} onRetry={load} />}
      {!data && !error && <Loading label="Loading providers" />}

      {data && (
        <Card>
          {data.providers.length === 0 ? (
            <Empty title="No providers match that">
              {status === 'PENDING'
                ? 'Nothing waiting on review right now.'
                : 'Try clearing the filters.'}
            </Empty>
          ) : (
            <div className="table-scroll">
              <table className="dtable">
                <thead>
                  <tr>
                    <th>Business</th>
                    <th>Contact</th>
                    <th>Status</th>
                    <th>Submitted</th>
                    <th className="text-right">Jobs</th>
                    <th className="text-right">Docs</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.providers.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <Link to={`/admin/providers/${p.id}`} className="link font-semibold">
                          {p.businessName}
                        </Link>
                        {!p.user.isActive && <span className="badge badge-stop ml-2">Disabled</span>}
                      </td>
                      <td>
                        <span className="block">{p.user.fullName}</span>
                        <span className="block text-[12px] text-[var(--color-ink-3)]">
                          {p.user.email}
                          {p.user.phone && ` · ${p.user.phone}`}
                        </span>
                      </td>
                      <td>
                        <Badge tone={PROVIDER_TONE[p.status]}>{titleCase(p.status)}</Badge>
                      </td>
                      <td className="ref text-[12px] text-[var(--color-ink-3)] whitespace-nowrap">
                        {p.submittedAt ? dateTimeFull(p.submittedAt) : '—'}
                      </td>
                      <td className="text-right ref">{p._count.jobs}</td>
                      <td className="text-right ref">{p._count.documents}</td>
                      <td className="text-right">
                        <Link
                          to={`/admin/providers/${p.id}`}
                          className={`btn btn-sm ${p.status === 'PENDING' ? 'btn-primary' : 'btn-outline'}`}
                        >
                          {p.status === 'PENDING' ? 'Review' : 'Open'}
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
