import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { money, duration } from '../lib/format.js';
import { Badge, Button, Card, Eyebrow, Input, Loading, ErrorState } from '../components/ui.jsx';

/** Postcode check on the hero — the first question every customer has. */
function CoverageCheck() {
  const [postcode, setPostcode] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const check = async (e) => {
    e.preventDefault();
    if (postcode.trim().length < 3) return;
    setBusy(true);
    setResult(null);
    try {
      setResult(await api.catalog.coverage(postcode.trim()));
    } catch (err) {
      setResult({ covered: false, error: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="surface ticked p-4 sm:p-5">
      <Eyebrow className="mb-2.5">Check your postcode</Eyebrow>
      <form onSubmit={check} className="flex gap-2">
        <Input
          value={postcode}
          onChange={(e) => {
            setPostcode(e.target.value);
            setResult(null);
          }}
          placeholder="e.g. 4051"
          inputMode="numeric"
          aria-label="Postcode"
          maxLength={12}
          className="flex-1"
        />
        <Button type="submit" variant="ink" disabled={busy || postcode.trim().length < 3}>
          {busy ? '…' : 'Check'}
        </Button>
      </form>

      {result && (
        <div className="mt-3 rise">
          {result.covered ? (
            <div>
              <p className="text-[14px]">
                <span className="badge badge-go mr-2">Covered</span>
                We service{' '}
                <strong>
                  {result.area.name}, {result.area.region}
                </strong>
                .
              </p>
              <Button variant="primary" size="sm" className="mt-2.5" onClick={() => navigate('/book')}>
                Book a service →
              </Button>
            </div>
          ) : (
            <p className="text-[14px]">
              <span className="badge badge-mute mr-2">Not yet</span>
              We&apos;re not in {postcode.trim()} yet — we&apos;re expanding, so check back soon.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function Home() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const load = () => {
    setError(null);
    api.catalog.services().then(setData).catch(setError);
  };
  useEffect(load, []);

  return (
    <div>
      {/* ----------------------------------------------------------- hero */}
      <section className="grid lg:grid-cols-[1.35fr_1fr] gap-8 lg:gap-12 items-start pt-2 pb-12">
        <div className="rise">
          <Eyebrow className="mb-3">Property inspections &amp; maintenance</Eyebrow>
          <h1 className="text-[34px] sm:text-[46px] lg:text-[54px] leading-[1.03] mb-4">
            Book a licensed provider.
            <br />
            <span style={{ color: 'var(--color-hivis)' }}>Get it in writing.</span>
          </h1>
          <p className="text-[16.5px] text-[var(--color-ink-2)] max-w-xl mb-6">
            Fixed prices, verified trades, and a written report on your file the same day the work
            is done. Pick a service, choose a time that suits you, and track the job from booking
            to report.
          </p>

          <div className="flex flex-wrap gap-2.5 mb-8">
            <Link to="/book" className="btn btn-primary">
              Book a service →
            </Link>
            <Link to="/register?role=PROVIDER" className="btn btn-outline">
              Work with us
            </Link>
          </div>

          <ul className="grid sm:grid-cols-3 gap-x-5 gap-y-3">
            {[
              ['01', 'Licence & insurance checked', 'Every provider is verified before they take a single job.'],
              ['02', 'One fixed price', 'What you see at checkout is what you pay. No call-out surprises.'],
              ['03', 'Report on file', 'Photos and documents attached to your booking, permanently.'],
            ].map(([n, t, d]) => (
              <li key={n}>
                <span className="ref text-[11px] text-[var(--color-hivis)]">{n}</span>
                <p className="font-semibold text-[14.5px] mt-0.5" style={{ fontFamily: 'var(--font-display)' }}>
                  {t}
                </p>
                <p className="text-[13.5px] text-[var(--color-ink-3)]">{d}</p>
              </li>
            ))}
          </ul>
        </div>

        <div className="rise w-full" style={{ animationDelay: '90ms' }}>
          <CoverageCheck />
        </div>
      </section>

      {/* ------------------------------------------------------- services */}
      <section className="rule pt-10">
        <div className="flex items-end justify-between gap-4 mb-6">
          <div>
            <Eyebrow className="mb-1.5">Our services</Eyebrow>
            <h2 className="text-2xl sm:text-[30px]">Fixed price, no quoting back and forth</h2>
          </div>
          <Link to="/book" className="btn btn-outline btn-sm hidden sm:inline-flex">
            Start a booking
          </Link>
        </div>

        {error && <ErrorState error={error} onRetry={load} />}
        {!data && !error && <Loading label="Loading services" />}

        {data?.categories.map((cat) => (
          <div key={cat.id} className="mb-9">
            <div className="flex items-center gap-3 mb-3.5">
              <h3 className="text-[15px] uppercase tracking-[.1em]" style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                {cat.name}
              </h3>
              <span className="flex-1 h-px" style={{ background: 'var(--color-rule)' }} />
            </div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {cat.services.map((s, i) => (
                <Card key={s.id} className="p-4 flex flex-col rise" ticked>
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <h4 className="text-[17px] leading-snug">{s.name}</h4>
                    {s.requiresReport && <Badge tone="badge-info">Report</Badge>}
                  </div>
                  <p className="text-[14px] text-[var(--color-ink-2)] flex-1">{s.shortDescription}</p>

                  <div className="rule mt-3.5 pt-3 flex items-end justify-between gap-3">
                    <div>
                      <p
                        className="text-[22px] leading-none tnum"
                        style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}
                      >
                        {money(s.basePriceCents, data.currency)}
                      </p>
                      <p className="ref text-[11px] text-[var(--color-ink-3)] mt-1">
                        {duration(s.durationMinutes)} on site
                      </p>
                    </div>
                    <Link to={`/book?service=${s.slug}`} className="btn btn-sm btn-ink">
                      Book
                    </Link>
                  </div>
                  <span hidden style={{ animationDelay: `${i * 50}ms` }} />
                </Card>
              ))}
            </div>
          </div>
        ))}
      </section>

      {/* ------------------------------------------------------ providers */}
      <section
        className="rule pt-10 mt-2"
      >
        <div className="surface p-6 sm:p-8" style={{ background: 'var(--color-navy)', borderColor: 'var(--color-navy)' }}>
          <div className="grid lg:grid-cols-[1.2fr_1fr] gap-7 items-center">
            <div>
              <p className="eyebrow mb-2.5" style={{ color: 'rgba(255,255,255,.55)' }}>
                For trades &amp; inspectors
              </p>
              <h2 className="text-white text-2xl sm:text-[30px] mb-3">
                Jobs on your phone. Paid after every one.
              </h2>
              <p className="text-white/70 max-w-xl mb-5">
                Get verified once, then see available work in your area and accept what suits you.
                First to tap gets the job. Upload the report from site and your payment is queued
                the moment it lands.
              </p>
              <Link to="/register?role=PROVIDER" className="btn btn-primary">
                Apply to join →
              </Link>
            </div>

            <ul className="space-y-3">
              {[
                'Set your own services and suburbs',
                'See exactly what each job pays before you accept',
                'No bidding, no undercutting — one fixed rate',
                'Earnings page shows pending and paid, always',
              ].map((t) => (
                <li key={t} className="flex gap-2.5 text-white/85 text-[14.5px]">
                  <span style={{ color: 'var(--color-hivis)' }} aria-hidden="true">
                    ▸
                  </span>
                  {t}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}
