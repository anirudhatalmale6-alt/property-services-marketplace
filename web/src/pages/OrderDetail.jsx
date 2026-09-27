import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import {
  addressLine,
  bytes,
  dateTimeFull,
  dateLong,
  money,
  relative,
  statusTone,
  timeOnly,
  titleCase,
} from '../lib/format.js';
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmButton,
  ErrorState,
  Eyebrow,
  Loading,
  Row,
  Spinner,
  Timeline,
} from '../components/ui.jsx';
import { useJobWatch, useSocketEvent } from '../lib/socket.js';

/** The customer's live progress bar, derived from the status. */
const TRACK = ['OPEN', 'ASSIGNED', 'EN_ROUTE', 'IN_PROGRESS', 'COMPLETED'];
const TRACK_LABEL = {
  OPEN: 'Finding a provider',
  ASSIGNED: 'Provider assigned',
  EN_ROUTE: 'On the way',
  IN_PROGRESS: 'Work underway',
  COMPLETED: 'Complete',
};

function ProgressTrack({ status }) {
  // AWAITING_REPORT sits between in-progress and complete as far as the
  // customer is concerned — the visit happened, the paperwork is pending.
  const effective = status === 'AWAITING_REPORT' ? 'IN_PROGRESS' : status;
  const idx = TRACK.indexOf(effective);
  if (idx === -1) return null;

  return (
    <ol className="flex items-stretch gap-1.5">
      {TRACK.map((s, i) => {
        const done = i < idx;
        const now = i === idx;
        return (
          <li key={s} className="flex-1 min-w-0">
            <span
              className="block h-1.5 mb-2"
              style={{
                background: done || now ? 'var(--color-hivis)' : 'var(--color-rule-strong)',
                opacity: now ? 1 : done ? 0.55 : 1,
              }}
            />
            <span
              className={`block text-[10.5px] leading-tight uppercase tracking-[.07em] ${
                now ? 'text-[var(--color-ink)] font-semibold' : 'text-[var(--color-ink-3)]'
              }`}
              style={{ fontFamily: 'var(--font-mono)' }}
            >
              {TRACK_LABEL[s]}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export default function OrderDetail() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const justPaid = params.get('justPaid') === '1';

  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  const load = useCallback(() => {
    setError(null);
    api.bookings.get(id).then(setData).catch(setError);
  }, [id]);

  useEffect(load, [load]);

  // Live updates while this page is open — no refresh needed to see the
  // provider accept, set off, or file the report.
  useJobWatch(id);
  useSocketEvent('job:updated', (job) => {
    if (job?.id === id) load();
  });

  const payNow = async () => {
    setBusy(true);
    try {
      await api.bookings.paymentIntent(id);
      const r = await api.bookings.confirmMock(id, true);
      setData((d) => ({ ...d, job: { ...d.job, ...r.job } }));
      setNotice('Payment received — we’re finding you a provider now.');
      load();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (reason) => {
    const r = await api.bookings.cancel(id, reason || undefined);
    setNotice(r.message);
    load();
  };

  if (error && !data) return <ErrorState error={error} onRetry={load} />;
  if (!data) return <Loading label="Loading your booking" />;

  const { job, currency, timeline } = data;
  const st = statusTone(job.status);
  const canCancel = !['COMPLETED', 'CANCELLED', 'REFUNDED'].includes(job.status);
  const reports = job.documents?.filter((d) => d.kind === 'JOB_REPORT') ?? [];
  const photos = job.documents?.filter((d) => d.kind === 'JOB_PHOTO') ?? [];

  return (
    <div className="max-w-4xl">
      <Link to="/orders" className="btn btn-quiet btn-sm -ml-2 mb-3">
        ← All bookings
      </Link>

      {justPaid && job.status !== 'PENDING_PAYMENT' && (
        <Alert tone="go" className="mb-5" title="You're booked in">
          We&apos;ve emailed your confirmation. As soon as a provider accepts the job you&apos;ll
          hear from us — this page updates on its own.
        </Alert>
      )}
      {notice && (
        <Alert tone="info" className="mb-5">
          {notice}
        </Alert>
      )}
      {error && (
        <Alert tone="stop" className="mb-5">
          {error.message}
        </Alert>
      )}

      {/* ------------------------------------------------------------ head */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
        <div>
          <div className="flex items-center gap-2.5 mb-1.5">
            <span className="ref text-[13px] text-[var(--color-ink-3)]">{job.reference}</span>
            <Badge tone={st.tone}>{st.label}</Badge>
          </div>
          <h1 className="text-2xl sm:text-3xl">{job.service.name}</h1>
        </div>
        <p
          className="text-[26px] leading-none tnum"
          style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}
        >
          {money(job.priceCents, currency)}
        </p>
      </div>

      {/* Outstanding payment is the only thing that matters if it's unpaid. */}
      {job.status === 'PENDING_PAYMENT' && (
        <Card className="p-4 mb-5" ticked>
          <Eyebrow className="mb-1.5">Action needed</Eyebrow>
          <p className="mb-3">
            This booking isn&apos;t confirmed until payment goes through. Your appointment slot
            isn&apos;t held until then.
          </p>
          <Button variant="primary" onClick={payNow} disabled={busy}>
            {busy ? <Spinner /> : null}
            Pay {money(job.priceCents, currency)} now
          </Button>
        </Card>
      )}

      {!['PENDING_PAYMENT', 'CANCELLED', 'REFUNDED'].includes(job.status) && (
        <Card className="p-4 sm:p-5 mb-5">
          <Eyebrow className="mb-3.5">Progress</Eyebrow>
          <ProgressTrack status={job.status} />
          {job.status === 'OPEN' && (
            <p className="text-[13.5px] text-[var(--color-ink-2)] mt-3.5 flex items-center gap-2">
              <span className="pulse-dot" style={{ color: 'var(--color-hivis)' }}>
                ●
              </span>
              Your job is live with our providers in {job.area?.name ?? 'your area'}. We&apos;ll
              confirm the moment one accepts it.
            </p>
          )}
          {job.status === 'AWAITING_REPORT' && (
            <p className="text-[13.5px] text-[var(--color-ink-2)] mt-3.5">
              The visit is done. We&apos;re waiting on the written report before we close the job
              out and release the provider&apos;s payment.
            </p>
          )}
        </Card>
      )}

      <div className="grid md:grid-cols-[1.25fr_1fr] gap-5">
        {/* ------------------------------------------------------- details */}
        <div className="space-y-5">
          <Card className="p-4 sm:p-5">
            <Eyebrow className="mb-2.5">Appointment</Eyebrow>
            <p className="text-[17px] font-semibold" style={{ fontFamily: 'var(--font-display)' }}>
              {dateLong(job.scheduledStart)}
            </p>
            <p className="text-[15px] text-[var(--color-ink-2)] mb-3.5">
              {timeOnly(job.scheduledStart)} – {timeOnly(job.scheduledEnd)}{' '}
              <span className="text-[var(--color-ink-3)]">({relative(job.scheduledStart)})</span>
            </p>

            <div className="rule pt-2">
              <Row label="Property">{addressLine(job.address)}</Row>
              {job.address?.notes && <Row label="Access">{job.address.notes}</Row>}
              {job.customerNotes && <Row label="Your notes">{job.customerNotes}</Row>}
            </div>
          </Card>

          {job.provider && (
            <Card className="p-4 sm:p-5">
              <Eyebrow className="mb-2.5">Your provider</Eyebrow>
              <p className="text-[17px] font-semibold" style={{ fontFamily: 'var(--font-display)' }}>
                {job.provider.businessName}
              </p>
              <p className="text-[14px] text-[var(--color-ink-2)]">{job.provider.user?.fullName}</p>
              {/* The provider's number is only useful once they're assigned. */}
              {job.provider.user?.phone &&
                ['ASSIGNED', 'EN_ROUTE', 'IN_PROGRESS'].includes(job.status) && (
                  <a href={`tel:${job.provider.user.phone}`} className="btn btn-outline btn-sm mt-3">
                    Call {job.provider.user.phone}
                  </a>
                )}
            </Card>
          )}

          {(reports.length > 0 || photos.length > 0) && (
            <Card className="p-4 sm:p-5">
              <Eyebrow className="mb-3">
                {reports.length > 0 ? 'Report & documents' : 'Photos'}
              </Eyebrow>
              <ul className="space-y-2">
                {[...reports, ...photos].map((d) => (
                  <li key={d.id}>
                    <a
                      href={api.documentUrl(d.id)}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-between gap-3 py-2 px-2.5 -mx-1 hover:bg-[var(--color-paper-2)] transition-colors"
                      style={{ border: '1px solid var(--color-rule)' }}
                    >
                      <span className="min-w-0">
                        <span className="block text-[14px] font-semibold truncate">{d.fileName}</span>
                        <span className="ref text-[11px] text-[var(--color-ink-3)]">
                          {titleCase(d.kind)} · {bytes(d.sizeBytes)}
                        </span>
                      </span>
                      <span className="ref text-[11.5px] flex-none" style={{ color: 'var(--color-info)' }}>
                        OPEN ↗
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        {/* ------------------------------------------------------- sidebar */}
        <div className="space-y-5">
          <Card className="p-4 sm:p-5">
            <Eyebrow className="mb-2.5">Payment</Eyebrow>
            <div className="rule pt-2">
              <Row label="Service">{money(job.priceCents, currency)}</Row>
              <Row label="Status">
                {job.payment ? (
                  <Badge tone={job.payment.status === 'SUCCEEDED' ? 'badge-go' : 'badge-hold'}>
                    {titleCase(job.payment.status)}
                  </Badge>
                ) : (
                  <Badge tone="badge-hold">Not started</Badge>
                )}
              </Row>
              {job.payment?.paidAt && (
                <Row label="Paid" mono>
                  {dateTimeFull(job.payment.paidAt)}
                </Row>
              )}
              {job.payment?.refundedCents > 0 && (
                <Row label="Refunded" mono>
                  {money(job.payment.refundedCents, currency)}
                </Row>
              )}
            </div>
          </Card>

          {timeline?.length > 0 && (
            <Card className="p-4 sm:p-5">
              <Eyebrow className="mb-3.5">History</Eyebrow>
              <Timeline
                items={timeline.map((t) => ({
                  title: t.label || titleCase(t.status),
                  note: t.note,
                  at: dateTimeFull(t.at),
                }))}
              />
            </Card>
          )}

          {canCancel && (
            <Card className="p-4 sm:p-5">
              <Eyebrow className="mb-2">Need to cancel?</Eyebrow>
              <p className="text-[13.5px] text-[var(--color-ink-2)] mb-3">
                Free up to 24 hours before your appointment. Inside that window our team reviews the
                refund and comes back to you.
              </p>
              <ConfirmButton
                variant="danger"
                size="sm"
                title="Cancel this booking?"
                body={`Booking ${job.reference} — ${job.service.name} on ${dateTimeFull(job.scheduledStart)}.`}
                confirmLabel="Cancel booking"
                needsReason
                reasonLabel="Reason (helps us improve)"
                onConfirm={cancel}
              >
                Cancel booking
              </ConfirmButton>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
