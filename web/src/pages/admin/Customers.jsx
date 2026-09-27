import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { dateTimeFull } from '../../lib/format.js';
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmButton,
  Empty,
  ErrorState,
  Input,
  Loading,
  PageHead,
} from '../../components/ui.jsx';

export default function AdminCustomers() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') || '';
  const page = Number(params.get('page') || 1);

  const [search, setSearch] = useState(q);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const load = useCallback(() => {
    setError(null);
    api.admin.customers({ q: q || undefined, page, perPage: 25 }).then(setData).catch(setError);
  }, [q, page]);

  useEffect(() => {
    setData(null);
    load();
  }, [load]);

  const pages = data ? Math.max(1, Math.ceil(data.total / data.perPage)) : 1;

  const setParam = (k, v) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    if (k !== 'page') next.delete('page');
    setParams(next);
  };

  return (
    <div>
      <PageHead eyebrow="Demand" title="Customers" sub="Registered accounts and their booking history." />

      {notice && (
        <Alert tone="go" className="mb-5">
          {notice}
        </Alert>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setParam('q', search.trim());
        }}
        className="flex gap-2 mb-5 max-w-lg"
      >
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Name, email or phone"
          className="flex-1"
        />
        <Button type="submit" variant="ink">
          Search
        </Button>
        {q && (
          <Button
            variant="quiet"
            type="button"
            onClick={() => {
              setSearch('');
              setParam('q', '');
            }}
          >
            Clear
          </Button>
        )}
      </form>

      {error && <ErrorState error={error} onRetry={load} />}
      {!data && !error && <Loading label="Loading customers" />}

      {data && (
        <>
          <p className="ref text-[11.5px] text-[var(--color-ink-3)] mb-2.5">
            {data.total} CUSTOMER{data.total === 1 ? '' : 'S'}
          </p>

          <Card>
            {data.customers.length === 0 ? (
              <Empty title="No customers match that" />
            ) : (
              <div className="table-scroll">
                <table className="dtable">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Contact</th>
                      <th>Joined</th>
                      <th>Last seen</th>
                      <th className="text-right">Bookings</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {data.customers.map((c) => (
                      <tr key={c.id}>
                        <td className="font-semibold">
                          {c.fullName}
                          {!c.isActive && <Badge tone="badge-stop" className="ml-2">Disabled</Badge>}
                        </td>
                        <td>
                          <span className="block">{c.email}</span>
                          {c.phone && (
                            <span className="block ref text-[12px] text-[var(--color-ink-3)]">
                              {c.phone}
                            </span>
                          )}
                        </td>
                        <td className="ref text-[12px] text-[var(--color-ink-3)] whitespace-nowrap">
                          {dateTimeFull(c.createdAt)}
                        </td>
                        <td className="ref text-[12px] text-[var(--color-ink-3)] whitespace-nowrap">
                          {c.lastLoginAt ? dateTimeFull(c.lastLoginAt) : '—'}
                        </td>
                        <td className="text-right ref">{c._count.jobs}</td>
                        <td className="text-right">
                          <ConfirmButton
                            variant="outline"
                            size="sm"
                            title={c.isActive ? 'Disable this account?' : 'Re-enable this account?'}
                            body={
                              c.isActive
                                ? `${c.fullName} will be signed out everywhere and unable to log in. Existing bookings are not affected.`
                                : `${c.fullName} will be able to sign in again.`
                            }
                            confirmLabel={c.isActive ? 'Disable' : 'Re-enable'}
                            onConfirm={async () => {
                              await api.admin.setUserActive(c.id, !c.isActive);
                              setNotice(`${c.fullName} ${c.isActive ? 'disabled' : 're-enabled'}.`);
                              load();
                            }}
                          >
                            {c.isActive ? 'Disable' : 'Enable'}
                          </ConfirmButton>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {pages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setParam('page', String(page - 1))}>
                ← Previous
              </Button>
              <span className="ref text-[12px] text-[var(--color-ink-3)]">
                PAGE {page} OF {pages}
              </span>
              <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setParam('page', String(page + 1))}>
                Next →
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
