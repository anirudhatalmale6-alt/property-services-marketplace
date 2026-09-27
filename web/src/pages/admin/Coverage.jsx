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
        sub="Open a new market by adding its zip. Change what a service costs and what it pays."
      />

      <div className="flex gap-2 mb-5">
        {[
          ['areas', 'Service areas'],
          ['services', 'Services & pricing'],
          ['split', 'Platform fee'],
        ].map(([v, label]) => (
          <button key={v} onClick={() => setTab(v)} className={`chip px-3.5 ${tab === v ? 'chip-on' : ''}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'areas' && <Areas />}
      {tab === 'services' && <Services />}
      {tab === 'split' && <PlatformFee />}
    </div>
  );
}

/* ----------------------------------------------------------- platform fee */

/**
 * SOP §10: "The system must not hard-code a fixed fee percentage."
 * This screen is the proof — the split is one stored number the business owns.
 */
function PlatformFee() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setError(null);
    api.admin
      .payoutSettings()
      .then((r) => {
        setData(r);
        setValue(String(r.inspectorPercent));
      })
      .catch(setError);
  }, []);
  useEffect(load, [load]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.admin.setPayoutSettings(Number(value));
      setData(r);
      setNotice(r.message);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  if (error && !data) return <ErrorState error={error} onRetry={load} />;
  if (!data) return <Loading label="Loading fee settings" />;

  const pct = Number(value);
  const valid = Number.isFinite(pct) && pct >= 0 && pct <= 100;
  // A worked example on a round number makes the split concrete.
  const exampleCents = 55_000;

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

      <div className="grid md:grid-cols-[1fr_1fr] gap-5">
        <Card className="p-4 sm:p-5" ticked>
          <Eyebrow className="mb-2.5">Default inspector share</Eyebrow>
          <p className="text-[14px] text-[var(--color-ink-2)] mb-4">
            The share of every booking that goes to the inspector. The rest is your platform
            revenue. Individual services can override this on the Services tab.
          </p>

          <Field label="Inspector keeps (%)" required>
            <Input
              type="number"
              step="0.25"
              min="0"
              max="100"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </Field>

          <Button
            variant="primary"
            className="mt-4"
            onClick={save}
            disabled={busy || !valid || pct === data.inspectorPercent}
          >
            {busy ? <Spinner /> : null}
            Save split
          </Button>

          <p className="text-[12.5px] text-[var(--color-ink-3)] mt-3.5">
            Changing this affects new bookings only. Jobs already booked keep the split they were
            quoted at, so nobody&apos;s pay changes retroactively.
          </p>
        </Card>

        <Card className="p-4 sm:p-5">
          <Eyebrow className="mb-3.5">On a {moneyExact(exampleCents, 'USD')} inspection</Eyebrow>
          {valid ? (
            <>
              <div className="rule pt-2">
                <div className="flex justify-between py-2">
                  <span className="label mb-0">Customer pays</span>
                  <span className="ref">{moneyExact(exampleCents, 'USD')}</span>
                </div>
                <div className="flex justify-between py-2">
                  <span className="label mb-0">Inspector receives</span>
                  <span className="ref" style={{ color: 'var(--color-go)' }}>
                    {moneyExact(Math.round((exampleCents * pct) / 100), 'USD')}
                  </span>
                </div>
                <div className="flex justify-between py-2">
                  <span className="label mb-0">Your gross share</span>
                  <span className="ref" style={{ color: 'var(--color-hivis-dark)' }}>
                    {moneyExact(exampleCents - Math.round((exampleCents * pct) / 100), 'USD')}
                  </span>
                </div>
              </div>

              <span
                className="flex mt-4 h-2.5 overflow-hidden"
                style={{ border: '1px solid var(--color-rule-strong)' }}
              >
                <span style={{ width: `${pct}%`, background: 'var(--color-go)' }} />
                <span style={{ width: `${100 - pct}%`, background: 'var(--color-hivis)' }} />
              </span>
              <p className="ref text-[11px] text-[var(--color-ink-3)] mt-2">
                INSPECTOR {pct}% · PLATFORM {(100 - pct).toFixed(2).replace(/\.00$/, '')}%
              </p>
            </>
          ) : (
            <p className="text-[var(--color-stop)] text-[14px]">Enter a percentage between 0 and 100.</p>
          )}

          <p className="text-[12.5px] text-[var(--color-ink-3)] mt-4 rule pt-3">
            Processor fees, refunds and taxes are recorded separately against each payment, so this
            figure is your gross share rather than net profit.
          </p>
        </Card>
      </div>
    </>
  );
}

/* ---------------------------------------------------------------- areas */

function Areas() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: '', zip: '', city: '', state: '', country: 'US' });

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
        zip: form.zip.trim(),
        city: form.city.trim(),
        state: form.state.trim().toUpperCase(),
        country: form.country.trim().toUpperCase(),
      });
      setNotice(`${form.name.trim()} is now live — customers in ${form.zip.trim()} can book.`);
      setOpen(false);
      setForm({ name: '', zip: '', city: '', state: '', country: 'US' });
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
    (acc[a.state] ||= []).push(a);
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
        {Object.entries(byRegion).map(([state, areas]) => (
          <Card key={state}>
            <div className="p-3.5 border-b flex items-center justify-between">
              <Eyebrow>{state}</Eyebrow>
              <span className="ref text-[11.5px] text-[var(--color-ink-3)]">
                {areas.length} AREA{areas.length === 1 ? '' : 'S'}
              </span>
            </div>
            <div className="table-scroll">
              <table className="dtable">
                <thead>
                  <tr>
                    <th>Area</th>
                    <th>ZIP code</th>
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
                      <td className="ref">{a.zip}</td>
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
          A customer can book in these ZIP codes but nobody will be able to accept the job — it will
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
              disabled={busy || !form.name || !form.zip || !form.city || !form.state}
            >
              {busy ? <Spinner /> : null}
              Open market
            </Button>
          </>
        }
      >
        <p className="text-[14px] mb-4">
          One ZIP code per area. As soon as you save it, customers there can get a price and book —
          so add your providers&apos; coverage first, or the jobs will have nobody to take them.
        </p>
        <div className="grid gap-3.5">
          <Field label="Area name" required hint="How it reads to your team, e.g. “North Dallas”.">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3.5">
            <Field label="ZIP code" required>
              <Input
                value={form.zip}
                onChange={(e) => setForm({ ...form, zip: e.target.value })}
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
                value={form.state}
                onChange={(e) => setForm({ ...form, state: e.target.value })}
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
                <th className="text-right">Base price</th>
                <th>Inspector payout</th>
                <th className="text-right">Your share</th>
                <th>On site</th>
                <th>Report</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.services.map((s) => {
                // Mirrors the server rule: a service without its own percentage
                // inherits the global default.
                const bp =
                  s.payoutMode === 'PERCENT'
                    ? (s.payoutPercentBp ?? data.defaultPayoutPercentBp)
                    : null;
                const payoutLabel =
                  s.payoutMode === 'FIXED'
                    ? moneyExact(s.providerPayCents ?? 0, data.currency)
                    : `${(bp / 100).toFixed(2).replace(/\.00$/, '')}%`;
                const sharePct = bp != null ? (10000 - bp) / 100 : null;
                const rules = (s.priceRules ?? []).filter((r) => r.isActive);
                return (
                  <tr key={s.id}>
                    <td className="font-semibold">
                      {s.name}
                      <span className="block ref text-[11px] text-[var(--color-ink-3)]">{s.slug}</span>
                      {rules.length > 0 && (
                        <span className="block text-[11.5px] text-[var(--color-ink-3)]">
                          {rules.filter((r) => r.kind === 'SQFT_TIER').length} size tiers ·{' '}
                          {rules.filter((r) => r.kind === 'ADD_ON').length} add-ons
                        </span>
                      )}
                    </td>
                    <td>{s.category.name}</td>
                    <td className="text-right ref">{moneyExact(s.basePriceCents, data.currency)}</td>
                    <td>
                      <span className="ref">{payoutLabel}</span>
                      <span className="block text-[11px] text-[var(--color-ink-3)]">
                        {s.payoutMode === 'FIXED'
                          ? 'flat per job'
                          : s.payoutPercentBp != null
                            ? 'service override'
                            : 'global default'}
                      </span>
                    </td>
                    <td className="text-right ref">
                      {sharePct != null ? `${sharePct}%` : '—'}
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
    payoutMode: service?.payoutMode ?? 'PERCENT',
    payoutPercent:
      service?.payoutPercentBp != null ? String(service.payoutPercentBp / 100) : '',
    pay: service?.providerPayCents != null ? (service.providerPayCents / 100).toFixed(2) : '',
    collectsSquareFeet: service?.collectsSquareFeet ?? false,
    collectsYearBuilt: service?.collectsYearBuilt ?? false,
    durationMinutes: service?.durationMinutes ?? 60,
    requiresReport: service?.requiresReport ?? true,
    isActive: service?.isActive ?? true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const priceCents = Math.round(Number(form.price) * 100);
  const payCents = form.pay === '' ? null : Math.round(Number(form.pay) * 100);
  const isFixed = form.payoutMode === 'FIXED';
  const payTooHigh = isFixed && payCents != null && payCents > priceCents;
  const fixedMissing = isFixed && (payCents == null || !Number.isFinite(payCents));

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
        payoutMode: form.payoutMode,
        // A blank percentage means "inherit the global default" — sent as null
        // rather than 0, which would pay the inspector nothing.
        payoutPercentBp:
          form.payoutMode === 'PERCENT' && form.payoutPercent !== ''
            ? Math.round(Number(form.payoutPercent) * 100)
            : null,
        providerPayCents: form.payoutMode === 'FIXED' ? payCents : null,
        durationMinutes: Number(form.durationMinutes),
        requiresReport: form.requiresReport,
        isActive: form.isActive,
        collectsSquareFeet: form.collectsSquareFeet,
        collectsYearBuilt: form.collectsYearBuilt,
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
    !payTooHigh &&
    !fixedMissing;

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
          <Field label="Inspector payout" required>
            <Select
              value={form.payoutMode}
              onChange={(e) => setForm({ ...form, payoutMode: e.target.value })}
            >
              <option value="PERCENT">Share of the price (%)</option>
              <option value="FIXED">Flat amount per job</option>
            </Select>
          </Field>
          {form.payoutMode === 'PERCENT' ? (
            <Field
              label="Inspector share (%)"
              hint="Leave blank to use the global split."
            >
              <Input
                type="number"
                step="0.25"
                min="0"
                max="100"
                value={form.payoutPercent}
                onChange={(e) => setForm({ ...form, payoutPercent: e.target.value })}
                placeholder="global default"
              />
            </Field>
          ) : (
            <Field
              label={`Flat payout (${currency})`}
              required
              error={
                payTooHigh
                  ? 'Cannot exceed the base price'
                  : fixedMissing
                    ? 'A flat payout needs an amount'
                    : undefined
              }
            >
              <Input
                type="number"
                step="0.01"
                min="0"
                value={form.pay}
                onChange={(e) => setForm({ ...form, pay: e.target.value })}
                error={payTooHigh || fixedMissing}
              />
            </Field>
          )}

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

        {priceCents > 0 && isFixed && payCents != null && !payTooHigh && (
          <p className="ref text-[12px] text-[var(--color-ink-3)]">
            ON THE BASE PRICE: YOUR SHARE {moneyExact(priceCents - payCents, currency)} (
            {Math.round(((priceCents - payCents) / priceCents) * 100)}%)
          </p>
        )}
        {!isFixed && (
          <p className="text-[12.5px] text-[var(--color-ink-3)]">
            A percentage applies to the <strong>final</strong> price, so square-footage tiers and
            add-ons are shared with the inspector automatically.
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
          <label className="flex items-center gap-2.5 text-[14px] cursor-pointer">
            <input
              type="checkbox"
              checked={form.collectsSquareFeet}
              onChange={(e) => setForm({ ...form, collectsSquareFeet: e.target.checked })}
            />
            Ask for square footage
          </label>
          <label className="flex items-center gap-2.5 text-[14px] cursor-pointer">
            <input
              type="checkbox"
              checked={form.collectsYearBuilt}
              onChange={(e) => setForm({ ...form, collectsYearBuilt: e.target.checked })}
            />
            Ask for year built
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
