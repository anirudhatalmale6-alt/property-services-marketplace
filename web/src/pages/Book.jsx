import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { dateLong, dayName, dateShort, duration, money, timeOnly } from '../lib/format.js';
import {
  Alert,
  Badge,
  Button,
  Card,
  Empty,
  ErrorState,
  Eyebrow,
  Field,
  Input,
  Loading,
  Row,
  Spinner,
  Stepper,
  Textarea,
} from '../components/ui.jsx';

const STEPS = ['Service', 'Property', 'Time', 'Pay'];

export default function Book() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [step, setStep] = useState(0);
  const [catalog, setCatalog] = useState(null);
  const [loadError, setLoadError] = useState(null);

  const [service, setService] = useState(null);

  // Property
  const [savedAddresses, setSavedAddresses] = useState([]);
  const [addressId, setAddressId] = useState('');
  const [addr, setAddr] = useState({
    line1: '',
    line2: '',
    city: '',
    state: '',
    zip: '',
    notes: '',
  });
  const [coverage, setCoverage] = useState(null);
  const [checkingCoverage, setCheckingCoverage] = useState(false);

  // Property details that drive the price (SOP §3.3).
  const [squareFeet, setSquareFeet] = useState('');
  const [yearBuilt, setYearBuilt] = useState('');
  const [addOns, setAddOns] = useState([]);
  const [selectedAddOns, setSelectedAddOns] = useState([]);
  const [payerType, setPayerType] = useState('CUSTOMER');
  const [payerName, setPayerName] = useState('');
  const [liveQuote, setLiveQuote] = useState(null);
  const [quoting, setQuoting] = useState(false);

  // Time
  const [availability, setAvailability] = useState(null);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [activeDate, setActiveDate] = useState(null);
  const [slot, setSlot] = useState(null);
  const [notes, setNotes] = useState('');

  // Pay
  const [job, setJob] = useState(null);
  const [payment, setPayment] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});

  /* ------------------------------------------------------------ catalogue */

  useEffect(() => {
    api.catalog.services().then(setCatalog).catch(setLoadError);
  }, []);

  // Deep link: /book?service=slug
  useEffect(() => {
    const slug = params.get('service');
    if (!slug || !catalog || service) return;
    for (const c of catalog.categories) {
      const found = c.services.find((s) => s.slug === slug);
      if (found) {
        setService(found);
        setStep(1);
        return;
      }
    }
  }, [params, catalog, service]);

  // Each service declares its own add-ons and which details it collects, so
  // the form is built from the catalogue rather than hard-coded per service.
  useEffect(() => {
    if (!service?.slug) return;
    api.catalog
      .service(service.slug)
      .then((r) => {
        setAddOns(r.addOns ?? []);
        setService((prev) => (prev ? { ...prev, ...r.service } : prev));
      })
      .catch(() => setAddOns([]));
    setSelectedAddOns([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service?.slug]);

  /**
   * Live price. Debounced, and re-quoted whenever an input that affects it
   * changes. This is an estimate for display — the binding number is
   * recalculated server-side at booking.
   */
  useEffect(() => {
    if (!service?.id) return undefined;
    const needsSqft = service.collectsSquareFeet && !squareFeet;
    const needsYear = service.collectsYearBuilt && !yearBuilt;
    if (needsSqft || needsYear) {
      setLiveQuote(null);
      return undefined;
    }

    setQuoting(true);
    const t = setTimeout(() => {
      api.catalog
        .quote({
          serviceId: service.id,
          squareFeet: squareFeet ? Number(squareFeet) : undefined,
          yearBuilt: yearBuilt ? Number(yearBuilt) : undefined,
          addOnIds: selectedAddOns,
        })
        .then(setLiveQuote)
        .catch(() => setLiveQuote(null))
        .finally(() => setQuoting(false));
    }, 300);

    return () => {
      clearTimeout(t);
      setQuoting(false);
    };
  }, [service?.id, service?.collectsSquareFeet, service?.collectsYearBuilt, squareFeet, yearBuilt, selectedAddOns]);

  useEffect(() => {
    if (!user || user.role !== 'CUSTOMER') return;
    api.bookings
      .addresses()
      .then((r) => setSavedAddresses(r.addresses))
      .catch(() => setSavedAddresses([]));
  }, [user]);

  /* ------------------------------------------------------------ coverage */

  const activeZip = addressId
    ? savedAddresses.find((a) => a.id === addressId)?.zip
    : addr.zip;

  const checkCoverage = useCallback(async (zip) => {
    if (!zip || zip.trim().length < 3) {
      setCoverage(null);
      return;
    }
    setCheckingCoverage(true);
    try {
      setCoverage(await api.catalog.coverage(zip.trim()));
    } catch {
      setCoverage(null);
    } finally {
      setCheckingCoverage(false);
    }
  }, []);

  // Debounced so typing a zip doesn't fire four requests.
  useEffect(() => {
    if (step !== 1) return undefined;
    const t = setTimeout(() => checkCoverage(activeZip), 350);
    return () => clearTimeout(t);
  }, [activeZip, step, checkCoverage]);

  /* --------------------------------------------------------- availability */

  useEffect(() => {
    if (step !== 2 || !service || !activeZip) return;
    setLoadingSlots(true);
    setAvailability(null);
    api.catalog
      .availability({ serviceId: service.id, zip: activeZip, days: 14 })
      .then((r) => {
        setAvailability(r);
        setActiveDate(r.days[0]?.date ?? null);
      })
      .catch((e) => setError(e))
      .finally(() => setLoadingSlots(false));
  }, [step, service, activeZip]);

  const slotsForActiveDate = useMemo(
    () => availability?.days.find((d) => d.date === activeDate)?.slots ?? [],
    [availability, activeDate],
  );

  /* ------------------------------------------------------------- actions */

  const addressValid =
    addressId ||
    (addr.line1.trim().length > 2 &&
      addr.city.trim().length > 1 &&
      addr.state.trim().length > 1 &&
      addr.zip.trim().length > 2);

  const goToTime = () => {
    setError(null);
    if (!addressValid) {
      setError(new Error('Please complete the property address.'));
      return;
    }
    if (coverage && !coverage.covered) {
      setError(new Error(`We don't cover ${activeZip} yet.`));
      return;
    }
    if (service?.collectsSquareFeet && !squareFeet) {
      setError(new Error('Please give the approximate square footage — it affects the price.'));
      return;
    }
    if (service?.collectsYearBuilt && !yearBuilt) {
      setError(new Error('Please give the year the property was built — it affects the price.'));
      return;
    }
    setStep(2);
  };

  const submitBooking = async () => {
    setSubmitting(true);
    setError(null);
    setFieldErrors({});
    try {
      const payload = {
        serviceId: service.id,
        scheduledStart: slot.start,
        customerNotes: notes || undefined,
        ...(squareFeet ? { squareFeet: Number(squareFeet) } : {}),
        ...(yearBuilt ? { yearBuilt: Number(yearBuilt) } : {}),
        addOnIds: selectedAddOns,
        payerType,
        ...(payerType !== 'CUSTOMER' && payerName.trim() ? { payerName: payerName.trim() } : {}),
        ...(addressId ? { addressId } : { address: cleanAddress(addr) }),
      };
      const r = await api.bookings.create(payload);
      setJob(r.job);
      setPayment(r.payment);
      setStep(3);
    } catch (e) {
      setError(e);
      if (e instanceof ApiError) setFieldErrors(e.fieldErrors);
      // A taken slot means the grid is stale — send them back to pick again.
      if (e.details?.some((d) => d.field === 'scheduledStart')) {
        setSlot(null);
        setStep(2);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const pay = async (succeed = true) => {
    setSubmitting(true);
    setError(null);
    try {
      const r = await api.bookings.confirmMock(job.id, succeed);
      navigate(`/orders/${r.job.id}?justPaid=1`);
    } catch (e) {
      setError(e);
    } finally {
      setSubmitting(false);
    }
  };

  /* ---------------------------------------------------------------- render */

  if (loadError) return <ErrorState error={loadError} onRetry={() => window.location.reload()} />;
  if (!catalog) return <Loading label="Loading services" />;

  return (
    <div className="max-w-3xl mx-auto">
      <Eyebrow className="mb-1.5">New booking</Eyebrow>
      <h1 className="text-2xl sm:text-3xl mb-6">
        {step === 0 && 'What do you need done?'}
        {step === 1 && 'Which property?'}
        {step === 2 && 'When suits you?'}
        {step === 3 && 'Confirm and pay'}
      </h1>

      <Stepper steps={STEPS} current={step} />

      {error && (
        <Alert tone="stop" className="mb-5">
          {error.message}
        </Alert>
      )}

      {/* ------------------------------------------------- 0: pick service */}
      {step === 0 && (
        <div className="space-y-6">
          {catalog.categories.map((cat) => (
            <div key={cat.id}>
              <Eyebrow className="mb-2.5">{cat.name}</Eyebrow>
              <div className="space-y-2.5">
                {cat.services.map((s) => (
                  <button
                    key={s.id}
                    className={`pick ${service?.id === s.id ? 'pick-on' : ''}`}
                    onClick={() => {
                      setService(s);
                      setParams({ service: s.slug }, { replace: true });
                      setStep(1);
                    }}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-[16.5px] font-semibold" style={{ fontFamily: 'var(--font-display)' }}>
                          {s.name}
                        </p>
                        <p className="text-[14px] text-[var(--color-ink-2)] mt-0.5">{s.shortDescription}</p>
                        <p className="ref text-[11.5px] text-[var(--color-ink-3)] mt-1.5">
                          {duration(s.durationMinutes)} on site
                          {s.requiresReport && ' · written report included'}
                        </p>
                      </div>
                      <p
                        className="text-[20px] leading-none flex-none tnum"
                        style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}
                      >
                        {money(s.basePriceCents, catalog.currency)}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ------------------------------------------------------ 1: property */}
      {step === 1 && (
        <div className="space-y-5">
          <ServiceSummary service={service} currency={catalog.currency} onChange={() => setStep(0)} />

          {savedAddresses.length > 0 && (
            <div>
              <Eyebrow className="mb-2.5">Saved properties</Eyebrow>
              <div className="space-y-2">
                {savedAddresses.map((a) => (
                  <button
                    key={a.id}
                    className={`pick ${addressId === a.id ? 'pick-on' : ''}`}
                    onClick={() => setAddressId(addressId === a.id ? '' : a.id)}
                  >
                    <p className="font-semibold text-[15px]">{a.label || a.line1}</p>
                    <p className="text-[14px] text-[var(--color-ink-2)]">
                      {[a.line1, a.city, a.state, a.zip].filter(Boolean).join(', ')}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {!addressId && (
            <Card className="p-4 sm:p-5">
              <Eyebrow className="mb-4">
                {savedAddresses.length > 0 ? 'Or a new property' : 'Property address'}
              </Eyebrow>
              <div className="grid gap-4">
                <Field label="Street address" required error={fieldErrors['address.line1']}>
                  <Input
                    value={addr.line1}
                    onChange={(e) => setAddr({ ...addr, line1: e.target.value })}
                    placeholder="18 Ferndale Street"
                    autoComplete="address-line1"
                  />
                </Field>
                <Field label="Unit / level (optional)">
                  <Input
                    value={addr.line2}
                    onChange={(e) => setAddr({ ...addr, line2: e.target.value })}
                    autoComplete="address-line2"
                  />
                </Field>
                <div className="grid sm:grid-cols-3 gap-4">
                  <Field label="City" required error={fieldErrors['address.city']}>
                    <Input
                      value={addr.city}
                      onChange={(e) => setAddr({ ...addr, city: e.target.value })}
                      autoComplete="address-level2"
                    />
                  </Field>
                  <Field label="State" required error={fieldErrors['address.state']}>
                    <Input
                      value={addr.state}
                      onChange={(e) => setAddr({ ...addr, state: e.target.value })}
                      placeholder="QLD"
                      autoComplete="address-level1"
                    />
                  </Field>
                  <Field label="ZIP code" required error={fieldErrors['address.zip']}>
                    <Input
                      value={addr.zip}
                      onChange={(e) => setAddr({ ...addr, zip: e.target.value })}
                      inputMode="numeric"
                      maxLength={12}
                      autoComplete="postal-code"
                    />
                  </Field>
                </div>
                <Field
                  label="Access notes (optional)"
                  hint="Gate codes, lockbox, pets, parking — anything the provider needs to get in."
                >
                  <Textarea
                    rows={2}
                    value={addr.notes}
                    onChange={(e) => setAddr({ ...addr, notes: e.target.value })}
                  />
                </Field>
              </div>
            </Card>
          )}

          {/* ------------------------------------------- property details */}
          {(service?.collectsSquareFeet || service?.collectsYearBuilt || addOns.length > 0) && (
            <Card className="p-4 sm:p-5">
              <Eyebrow className="mb-1.5">About the property</Eyebrow>
              <p className="text-[13.5px] text-[var(--color-ink-3)] mb-4">
                These affect the price, so the figure you see at checkout is the figure you pay.
              </p>

              <div className="grid sm:grid-cols-2 gap-4">
                {service.collectsSquareFeet && (
                  <Field
                    label="Approximate square footage"
                    required
                    error={fieldErrors.squareFeet}
                    hint="Living area. An estimate is fine."
                  >
                    <Input
                      type="number"
                      inputMode="numeric"
                      min="100"
                      max="50000"
                      value={squareFeet}
                      onChange={(e) => setSquareFeet(e.target.value)}
                      placeholder="2,400"
                    />
                  </Field>
                )}

                {service.collectsYearBuilt && (
                  <Field label="Year built" required error={fieldErrors.yearBuilt}>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min="1800"
                      max={new Date().getFullYear()}
                      value={yearBuilt}
                      onChange={(e) => setYearBuilt(e.target.value)}
                      placeholder="1998"
                    />
                  </Field>
                )}
              </div>

              {addOns.length > 0 && (
                <div className="mt-4">
                  <Eyebrow className="mb-2.5">Add anything else?</Eyebrow>
                  <div className="space-y-2">
                    {addOns.map((a) => {
                      const on = selectedAddOns.includes(a.id);
                      return (
                        <button
                          key={a.id}
                          type="button"
                          onClick={() =>
                            setSelectedAddOns((prev) =>
                              on ? prev.filter((x) => x !== a.id) : [...prev, a.id],
                            )
                          }
                          className={`pick ${on ? 'pick-on' : ''}`}
                          style={{ padding: '0.65rem 0.85rem' }}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span className="font-semibold text-[14.5px]">
                              {on ? '☑' : '☐'} {a.label}
                            </span>
                            <span className="ref text-[14px] flex-none">
                              +{money(a.amountCents, catalog.currency)}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Itemised live price — no surprises at checkout. */}
              {liveQuote && (
                <div className="rule mt-4 pt-3.5">
                  <Eyebrow className="mb-2.5">Your price</Eyebrow>
                  <div className="space-y-1">
                    {liveQuote.lines.map((l, i) => (
                      <div key={i} className="flex justify-between gap-4 text-[14px]">
                        <span className="text-[var(--color-ink-2)]">{l.label}</span>
                        <span className="ref flex-none">
                          {l.amountCents === 0 ? '—' : money(l.amountCents, liveQuote.currency)}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="rule mt-2.5 pt-2.5 flex items-end justify-between">
                    <span className="label mb-0">Total</span>
                    <span
                      className="text-[24px] leading-none tnum"
                      style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}
                    >
                      {money(liveQuote.priceCents, liveQuote.currency)}
                    </span>
                  </div>
                </div>
              )}
              {quoting && !liveQuote && (
                <p className="text-[13px] text-[var(--color-ink-3)] mt-3.5 flex items-center gap-2">
                  <Spinner /> Working out your price…
                </p>
              )}
            </Card>
          )}

          {/* ------------------------------------------------ who is paying */}
          <Card className="p-4 sm:p-5">
            <Eyebrow className="mb-2.5">Who&apos;s paying?</Eyebrow>
            <div className="grid sm:grid-cols-3 gap-2">
              {[
                ['CUSTOMER', 'Me'],
                ['REALTOR', 'My realtor'],
                ['COMPANY', 'A company account'],
              ].map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setPayerType(v)}
                  className={`pick ${payerType === v ? 'pick-on' : ''}`}
                  style={{ padding: '0.7rem 0.85rem' }}
                >
                  <span className="font-semibold text-[14px]">{label}</span>
                </button>
              ))}
            </div>
            {payerType !== 'CUSTOMER' && (
              <Field
                label={payerType === 'REALTOR' ? 'Realtor / brokerage name' : 'Company name'}
                className="mt-3.5"
                hint="So our team can match the payment to the right account."
              >
                <Input value={payerName} onChange={(e) => setPayerName(e.target.value)} />
              </Field>
            )}
          </Card>

          {/* Live coverage feedback, before they waste time picking a slot. */}
          {activeZip && activeZip.length >= 3 && (
            <div aria-live="polite">
              {checkingCoverage ? (
                <p className="text-[13.5px] text-[var(--color-ink-3)] flex items-center gap-2">
                  <Spinner /> Checking coverage for {activeZip}…
                </p>
              ) : coverage?.covered ? (
                <Alert tone="go">
                  Good news — we cover <strong>{coverage.area.name}</strong> ({coverage.area.city},{' '}
                  {coverage.area.state}).
                </Alert>
              ) : coverage ? (
                <Alert tone="hold" title={`We don't cover ${activeZip} yet`}>
                  We&apos;re expanding market by market. Nothing you enter here is lost — try a
                  different property, or check back soon.
                </Alert>
              ) : null}
            </div>
          )}

          <div className="flex gap-2.5">
            <Button variant="quiet" onClick={() => setStep(0)}>
              ← Back
            </Button>
            <Button
              variant="primary"
              className="flex-1 sm:flex-none"
              onClick={goToTime}
              disabled={!addressValid || (coverage && !coverage.covered) || checkingCoverage}
            >
              Choose a time →
            </Button>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------- 2: time */}
      {step === 2 && (
        <div className="space-y-5">
          <ServiceSummary service={service} currency={catalog.currency} onChange={() => setStep(0)} />

          {loadingSlots && <Loading label="Finding available times" />}

          {!loadingSlots && availability && availability.days.length === 0 && (
            <Card className="p-2">
              <Empty title="No times available right now">
                We don&apos;t have a provider free for this service in {activeZip} over the next
                two weeks. Try another service, or get in touch and we&apos;ll arrange it manually.
              </Empty>
            </Card>
          )}

          {!loadingSlots && availability?.days.length > 0 && (
            <>
              <div>
                <Eyebrow className="mb-2.5">Pick a day</Eyebrow>
                <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
                  {availability.days.map((d) => (
                    <button
                      key={d.date}
                      onClick={() => {
                        setActiveDate(d.date);
                        setSlot(null);
                      }}
                      className={`chip flex-none px-3 ${activeDate === d.date ? 'chip-on' : ''}`}
                      style={{ minWidth: 68 }}
                    >
                      <span className="block text-[10px] uppercase tracking-[.1em] opacity-75">
                        {dayName(d.date)}
                      </span>
                      <span className="block text-[14px] font-semibold">{dateShort(d.date)}</span>
                      <span className="block text-[10px] opacity-70">{d.slots.length} free</span>
                    </button>
                  ))}
                </div>
              </div>

              {activeDate && (
                <div>
                  <Eyebrow className="mb-2.5">
                    Start time — {dateLong(activeDate)}
                  </Eyebrow>
                  <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                    {slotsForActiveDate.map((s) => (
                      <button
                        key={s.start}
                        onClick={() => setSlot(s)}
                        className={`chip ${slot?.start === s.start ? 'chip-on' : ''}`}
                        title={
                          s.capacity === 1
                            ? 'Only one provider left at this time'
                            : `${s.capacity} providers free`
                        }
                      >
                        {timeOnly(s.start)}
                        {s.capacity === 1 && (
                          <span className="block text-[9px] opacity-75 leading-tight">last one</span>
                        )}
                      </button>
                    ))}
                  </div>
                  <p className="text-[13px] text-[var(--color-ink-3)] mt-2.5">
                    Finishes around {slot ? timeOnly(slot.end) : `${duration(service.durationMinutes)} later`}.
                  </p>
                </div>
              )}

              <Field
                label="Anything we should know? (optional)"
                hint="Context for the provider — what you're worried about, what to focus on."
              >
                <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </Field>

              <div className="flex gap-2.5">
                <Button variant="quiet" onClick={() => setStep(1)}>
                  ← Back
                </Button>
                <Button
                  variant="primary"
                  className="flex-1 sm:flex-none"
                  onClick={user ? submitBooking : undefined}
                  as={user ? 'button' : Link}
                  to={user ? undefined : `/login?next=/book?service=${service.slug}`}
                  disabled={!slot || submitting}
                >
                  {submitting ? <Spinner /> : null}
                  {user ? 'Continue to payment →' : 'Sign in to continue →'}
                </Button>
              </div>

              {!user && (
                <p className="text-[13.5px] text-[var(--color-ink-3)]">
                  You&apos;ll need an account so you can track the job and keep the report.{' '}
                  <Link to="/register" className="link">
                    Create one
                  </Link>{' '}
                  — it takes a moment.
                </p>
              )}
            </>
          )}
        </div>
      )}

      {/* ----------------------------------------------------------- 3: pay */}
      {step === 3 && job && (
        <div className="space-y-5">
          <Card className="p-4 sm:p-5" ticked>
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <Eyebrow className="mb-1">Booking reference</Eyebrow>
                <p className="ref text-xl">{job.reference}</p>
              </div>
              <Badge tone="badge-hold">Awaiting payment</Badge>
            </div>

            <div className="rule pt-2">
              <Row label="Service">{job.service.name}</Row>
              <Row label="When">
                {dateLong(job.scheduledStart)}, {timeOnly(job.scheduledStart)}–{timeOnly(job.scheduledEnd)}
              </Row>
              <Row label="Property">
                {[job.address.line1, job.address.city, job.address.state, job.address.zip]
                  .filter(Boolean)
                  .join(', ')}
              </Row>
              {job.customerNotes && <Row label="Your notes">{job.customerNotes}</Row>}
            </div>

            <div className="rule mt-2 pt-3 flex items-end justify-between">
              <span className="label mb-0">Total due</span>
              <span
                className="text-[26px] leading-none tnum"
                style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}
              >
                {money(job.priceCents, catalog.currency)}
              </span>
            </div>
          </Card>

          {payment?.driver === 'mock' ? (
            <Alert tone="info" title="Demo checkout">
              <p>
                This build runs on a simulated payment gateway so the whole flow works before any
                Stripe account exists. Use the buttons below to play out either outcome — a real
                card form drops in here once your Stripe keys are set, with no other change to the
                app.
              </p>
            </Alert>
          ) : (
            <Alert tone="info">Card payment is handled securely by Stripe.</Alert>
          )}

          <div className="flex flex-col sm:flex-row gap-2.5">
            <Button variant="primary" className="flex-1" onClick={() => pay(true)} disabled={submitting}>
              {submitting ? <Spinner /> : null}
              Pay {money(job.priceCents, catalog.currency)}
            </Button>
            {payment?.driver === 'mock' && (
              <Button variant="outline" onClick={() => pay(false)} disabled={submitting}>
                Simulate a declined card
              </Button>
            )}
          </div>

          <p className="text-[13px] text-[var(--color-ink-3)]">
            Free cancellation up to 24 hours before the appointment. After that, contact us and
            we&apos;ll sort it out.
          </p>
        </div>
      )}
    </div>
  );
}

function ServiceSummary({ service, currency, onChange }) {
  if (!service) return null;
  return (
    <div
      className="surface p-3.5 flex items-center justify-between gap-4"
      style={{ borderLeft: '3px solid var(--color-hivis)' }}
    >
      <div className="min-w-0">
        <Eyebrow className="mb-0.5">Selected</Eyebrow>
        <p className="font-semibold text-[15px] truncate" style={{ fontFamily: 'var(--font-display)' }}>
          {service.name}
        </p>
        <p className="ref text-[11.5px] text-[var(--color-ink-3)]">
          {money(service.basePriceCents, currency)} · {duration(service.durationMinutes)}
        </p>
      </div>
      <Button variant="quiet" size="sm" onClick={onChange} className="flex-none">
        Change
      </Button>
    </div>
  );
}

/** Drop empty optional fields so the API's optional-string rules are satisfied. */
function cleanAddress(a) {
  const out = { line1: a.line1.trim(), city: a.city.trim(), state: a.state.trim(), zip: a.zip.trim() };
  if (a.line2?.trim()) out.line2 = a.line2.trim();
  if (a.notes?.trim()) out.notes = a.notes.trim();
  return out;
}
