import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { money, moneyExact, titleCase } from '../../lib/format.js';
import {
  Alert,
  Badge,
  Button,
  Card,
  ErrorState,
  Eyebrow,
  Field,
  Input,
  Loading,
  Modal,
  PageHead,
  Select,
  Spinner,
  Textarea,
} from '../../components/ui.jsx';

/**
 * Coverage and pricing.
 *
 * This is the page that makes "expand nationwide" a data change: adding a
 * ServiceArea row opens a market. No deploy, no code.
 */
export default function AdminCoverage() {
  const [tab, setTab] = useState('areas');

  return (
    <div>
      <PageHead
        eyebrow="Configuration"
        title="Coverage &amp; pricing"
        sub="Open a new market by adding its postcode. Change what a service costs and what it pays."
      />

      <div className="flex gap-2 mb-5">
        {[
          ['areas', 'Service areas'],
          ['services', 'Services & pricing'],
        ].map(([v, label]) => (
          <button key={v} onClick={() => setTab(v)} className={`chip px-3.5 ${tab === v ? 'chip-on' : ''}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'areas' ? <Areas /> : <Services />}
    </div>
  );
}

/* ---------------------------------------------------------------- areas */

function Areas() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: '', postcode: '', city: '', region: '', country: 'AU' });

  const load = useCallback(() => {
    setError(null);
    api.admin.areas().then(setData).catch(setError);
  }, []);
  useEffect(load, [load]);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.admin.createArea({
        name: form.name.trim(),
        postcode: form.postcode.trim(),
        city: form.city.trim(),
        region: form.region.trim().toUpperCase(),
        country: form.country.trim().toUpperCase(),
      });
      setNotice(`${form.name.trim()} is now live — customers in ${form.postcode.trim()} can book.`);
      setOpen(false);
      setForm({ name: '', postcode: '', city: '', region: '', country: 'AU' });
      load();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (a) => {
    setError(null);
    try {
      await api.admin.updateArea(a.id, { isActive: !a.isActive });
      setNotice(`${a.name} ${a.isActive ? 'closed' : 'reopened'}.`);
      load();
    } catch (e) {
      setError(e);
    }
  };

  if (error && !data) return <ErrorState error={error} onRetry={load} />;
  if (!data) return <Loading label="Loading service areas" />;

  // Group by state so a national footprint stays readable.
  const byRegion = data.areas.reduce((acc, a) => {
    (acc[a.region] ||= []).push(a);
    return acc;
  }, {});

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

      <div className="flex items-center justify-between gap-4 mb-4">
        <p className="ref text-[12px] text-[var(--color-ink-3)]">
          {data.areas.filter((a) => a.isActive).length} LIVE · {Object.keys(byRegion).length} STATE
          {Object.keys(byRegion).length === 1 ? '' : 'S'}
        </p>
        <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
          + Open a new market
        </Button>
      </div>

      <div className="space-y-5">
        {Object.entries(byRegion).map(([region, areas]) => (
          <Card key={region}>
            <div className="p-3.5 border-b flex items-center justify-between">
              <Eyebrow>{region}</Eyebrow>
              <span className="ref text-[11.5px] text-[var(--color-ink-3)]">
                {areas.length} AREA{areas.length === 1 ? '' : 'S'}
              </span>
            </div>
            <div className="table-scroll">
              <table className="dtable">
                <thead>
                  <tr>
                    <th>Area</th>
                    <th>Postcode</th>
                    <th>City</th>
                    <th className="text-right">Providers</th>
                    <th className="text-right">Jobs</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {areas.map((a) => (
                    <tr key={a.id}>
                      <td className="font-semibold">{a.name}</td>
                      <td className="ref">{a.postcode}</td>
                      <td>{a.city}</td>
                      <td className="text-right ref">
                        {a._count.providers === 0 ? (
                          <span style={{ color: 'var(--color-hold)' }}>0</span>
                        ) : (
                          a._count.providers
                        )}
                      </td>
                      <td className="text-right ref">{a._count.jobs}</td>
                      <td>
                        <Badge tone={a.isActive ? 'badge-go' : 'badge-mute'}>
                          {a.isActive ? 'Live' : 'Closed'}
                        </Badge>
                      </td>
                      <td className="text-right">
                        <Button variant="quiet" size="sm" onClick={() => toggle(a)}>
                          {a.isActive ? 'Close' : 'Reopen'}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ))}
      </div>

      {data.areas.some((a) => a.isActive && a._count.providers === 0) && (
        <Alert tone="hold" className="mt-5" title="Some live areas have no providers">
          A customer can book in these postcodes but nobody will be able to accept the job — it will
          land in the exceptions queue. Either recruit providers there, or close the area until you
          have coverage.
        </Alert>
      )}

      <Modal
        open={open}
        onClose={() => !busy && setOpen(false)}
        title="Open a new market"
        footer={
          <>
            <Button variant="quiet" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={create}
              disabled={busy || !form.name || !form.postcode || !form.city || !form.region}
            >
              {busy ? <Spinner /> : null}
              Open market
            </Button>
          </>
        }
      >
        <p className="text-[14px] mb-4">
          One postcode per area. As soon as you save it, customers there can get a price and book —
          so add your providers&apos; coverage first, or the jobs will have nobody to take them.
        </p>
        <div className="grid gap-3.5">
          <Field label="Area name" required hint="How it reads to your team, e.g. “Newcastle West”.">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3.5">
            <Field label="Postcode" required>
              <Input
                value={form.postcode}
                onChange={(e) => setForm({ ...form, postcode: e.target.value })}
                inputMode="numeric"
              />
            </Field>
            <Field label="Country" required>
              <Input
                value={form.country}
                onChange={(e) => setForm({ ...form, country: e.target.value })}
                maxLength={2}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3.5">
            <Field label="City / suburb" required>
              <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
            </Field>
            <Field label="State" required>
              <Input
                value={form.region}
                onChange={(e) => setForm({ ...form, region: e.target.value })}
                placeholder="NSW"
              />
            </Field>
          </div>
        </div>
      </Modal>
    </>
  );
}

/* -------------------------------------------------------------- services */

function Services() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    setError(null);
    api.admin.services().then(setData).catch(setError);
  }, []);
  useEffect(load, [load]);

  if (error && !data) return <ErrorState error={error} onRetry={load} />;
  if (!data) return <Loading label="Loading services" />;

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

      <div className="flex items-center justify-between gap-4 mb-4">
        <p className="ref text-[12px] text-[var(--color-ink-3)]">
          {data.services.filter((s) => s.isActive).length} ACTIVE OF {data.services.length}
        </p>
        <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
          + Add a service
        </Button>
      </div>

      <Card>
        <div className="table-scroll">
          <table className="dtable">
            <thead>
              <tr>
                <th>Service</th>
                <th>Category</th>
                <th className="text-right">Customer pays</th>
                <th className="text-right">Provider gets</th>
                <th className="text-right">Margin</th>
                <th>On site</th>
                <th>Report</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.services.map((s) => {
                const margin = s.basePriceCents - s.providerPayCents;
                const pct = s.basePriceCents ? Math.round((margin / s.basePriceCents) * 100) : 0;
                return (
                  <tr key={s.id}>
                    <td className="font-semibold">
                      {s.name}
                      <span className="block ref text-[11px] text-[var(--color-ink-3)]">{s.slug}</span>
                    </td>
                    <td>{s.category.name}</td>
                    <td className="text-right ref">{moneyExact(s.basePriceCents, data.currency)}</td>
                    <td className="text-right ref">{moneyExact(s.providerPayCents, data.currency)}</td>
                    <td className="text-right ref">
                      {moneyExact(margin, data.currency)}
                      <span className="block text-[11px] text-[var(--color-ink-3)]">{pct}%</span>
                    </td>
                    <td className="ref">{s.durationMinutes}m</td>
                    <td>{s.requiresReport ? <Badge tone="badge-info">Yes</Badge> : '—'}</td>
                    <td>
                      <Badge tone={s.isActive ? 'badge-go' : 'badge-mute'}>
                        {s.isActive ? 'Active' : 'Hidden'}
                      </Badge>
                    </td>
                    <td className="text-right">
                      <Button variant="quiet" size="sm" onClick={() => setEditing(s)}>
                        Edit
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Alert tone="info" className="mt-5">
        Changing a price never affects a booking that already exists — each job stores what the
        customer was quoted and what the provider was promised at the moment it was made.
      </Alert>

      {(editing || creating) && (
        <ServiceForm
          service={editing}
          categories={data.categories}
          currency={data.currency}
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
          onSaved={(msg) => {
            setNotice(msg);
            setEditing(null);
            setCreating(false);
            load();
          }}
        />
      )}
    </>
  );
}

function ServiceForm({ service, categories, currency, onClose, onSaved }) {
  const isNew = !service;
  const [form, setForm] = useState({
    categoryId: service?.categoryId ?? categories[0]?.id ?? '',
    name: service?.name ?? '',
    slug: service?.slug ?? '',
    shortDescription: service?.shortDescription ?? '',
    description: service?.description ?? '',
    price: service ? (service.basePriceCents / 100).toFixed(2) : '',
    pay: service ? (service.providerPayCents / 100).toFixed(2) : '',
    durationMinutes: service?.durationMinutes ?? 60,
    requiresReport: service?.requiresReport ?? true,
    isActive: service?.isActive ?? true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const priceCents = Math.round(Number(form.price) * 100);
  const payCents = Math.round(Number(form.pay) * 100);
  const payTooHigh = Number.isFinite(priceCents) && Number.isFinite(payCents) && payCents > priceCents;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const payload = {
        categoryId: form.categoryId,
        name: form.name.trim(),
        slug: form.slug.trim().toLowerCase(),
        shortDescription: form.shortDescription.trim(),
        description: form.description.trim(),
        basePriceCents: priceCents,
        providerPayCents: payCents,
        durationMinutes: Number(form.durationMinutes),
        requiresReport: form.requiresReport,
        isActive: form.isActive,
      };
      if (isNew) {
        await api.admin.createService(payload);
        onSaved(`${payload.name} added.`);
      } else {
        await api.admin.updateService(service.id, payload);
        onSaved(`${payload.name} updated.`);
      }
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const valid =
    form.categoryId &&
    form.name.trim().length > 1 &&
    /^[a-z0-9-]+$/.test(form.slug.trim().toLowerCase()) &&
    form.shortDescription.trim().length > 1 &&
    form.description.trim().length > 1 &&
    priceCents >= 0 &&
    payCents >= 0 &&
    !payTooHigh;

  return (
    <Modal
      open
      onClose={() => !busy && onClose()}
      title={isNew ? 'Add a service' : `Edit ${service.name}`}
      width="max-w-2xl"
      footer={
        <>
          <Button variant="quiet" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={busy || !valid}>
            {busy ? <Spinner /> : null}
            {isNew ? 'Add service' : 'Save changes'}
          </Button>
        </>
      }
    >
      {error && (
        <Alert tone="stop" className="mb-4">
          {error.message}
        </Alert>
      )}

      <div className="grid gap-3.5">
        <Field label="Category" required>
          <Select
            value={form.categoryId}
            onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Name" required>
          <Input
            value={form.name}
            onChange={(e) => {
              const name = e.target.value;
              setForm((f) => ({
                ...f,
                name,
                // Derive the slug while creating, never silently on an existing
                // service — its slug is a public URL.
                slug: isNew
                  ? name
                      .toLowerCase()
                      .replace(/[^a-z0-9]+/g, '-')
                      .replace(/^-|-$/g, '')
                  : f.slug,
              }));
            }}
          />
        </Field>

        <Field label="URL slug" required hint="Lowercase letters, numbers and hyphens.">
          <Input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} />
        </Field>

        <Field label="One-line summary" required hint="Shown on the service card.">
          <Input
            value={form.shortDescription}
            onChange={(e) => setForm({ ...form, shortDescription: e.target.value })}
          />
        </Field>

        <Field label="Full description" required>
          <Textarea
            rows={4}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </Field>

        <div className="grid sm:grid-cols-3 gap-3.5">
          <Field label={`Customer pays (${currency})`} required>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={form.price}
              onChange={(e) => setForm({ ...form, price: e.target.value })}
            />
          </Field>
          <Field
            label={`Provider gets (${currency})`}
            required
            error={payTooHigh ? 'Cannot exceed the customer price' : undefined}
          >
            <Input
              type="number"
              step="0.01"
              min="0"
              value={form.pay}
              onChange={(e) => setForm({ ...form, pay: e.target.value })}
              error={payTooHigh}
            />
          </Field>
          <Field label="Minutes on site" required>
            <Input
              type="number"
              step="15"
              min="15"
              max="600"
              value={form.durationMinutes}
              onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })}
            />
          </Field>
        </div>

        {priceCents > 0 && payCents >= 0 && !payTooHigh && (
          <p className="ref text-[12px] text-[var(--color-ink-3)]">
            MARGIN {moneyExact(priceCents - payCents, currency)} (
            {Math.round(((priceCents - payCents) / priceCents) * 100)}%)
          </p>
        )}

        <div className="flex flex-wrap gap-5 rule pt-3.5">
          <label className="flex items-center gap-2.5 text-[14px] cursor-pointer">
            <input
              type="checkbox"
              checked={form.requiresReport}
              onChange={(e) => setForm({ ...form, requiresReport: e.target.checked })}
            />
            Requires a written report
          </label>
          <label className="flex items-center gap-2.5 text-[14px] cursor-pointer">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
            />
            Bookable by customers
          </label>
        </div>

        {form.requiresReport && (
          <p className="text-[12.5px] text-[var(--color-ink-3)]">
            A job for this service cannot be completed — and the provider is not paid — until the
            report is uploaded.
          </p>
        )}
      </div>
    </Modal>
  );
}
