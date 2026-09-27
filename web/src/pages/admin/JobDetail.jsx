import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import {
  addressLine,
  bytes,
  dateTimeFull,
  money,
  moneyExact,
  statusTone,
  timeOnly,
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
  ErrorState,
  Eyebrow,
  Field,
  Input,
  Loading,
  Modal,
  Row,
  Select,
  Spinner,
  Timeline,
} from '../../components/ui.jsx';
import { useJobWatch, useSocketEvent } from '../../lib/socket.js';

const ADMIN_STATUSES = [
  'OPEN',
  'ASSIGNED',
  'EN_ROUTE',
  'IN_PROGRESS',
  'AWAITING_REPORT',
  'COMPLETED',
  'CANCELLED',
];

export default function AdminJobDetail() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  const [assignOpen, setAssignOpen] = useState(false);
  const [candidates, setCandidates] = useState(null);
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundAmount, setRefundAmount] = useState('');

  const load = useCallback(() => {
    setError(null);
    api.admin.job(id).then(setData).catch(setError);
  }, [id]);

  useEffect(load, [load]);
  useJobWatch(id);
  useSocketEvent('job:updated', (j) => j?.id === id && load());

  const act = async (fn, msg) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setNotice(msg);
      load();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const openAssign = async () => {
    setAssignOpen(true);
    setCandidates(null);
    try {
      setCandidates((await api.admin.candidates(id)).candidates);
    } catch (e) {
      setError(e);
      setAssignOpen(false);
    }
  };

  if (error && !data) return <ErrorState error={error} onRetry={load} />;
  if (!data) return <Loading label="Loading job" />;

  const { job, currency } = data;
  const st = statusTone(job.status);
  const refundable =
    job.payment?.status === 'SUCCEEDED' || (job.payment?.refundedCents ?? 0) < (job.payment?.amountCents ?? 0);
  const remaining = job.payment ? job.payment.amountCents - job.payment.refundedCents : 0;

  return (
    <div className="max-w-5xl">
      <Link to="/admin/jobs" className="btn btn-quiet btn-sm -ml-2 mb-3">
        ← All jobs
      </Link>

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

      <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
        <div>
          <div className="flex items-center gap-2.5 mb-1.5">
            <span className="ref text-[13px]">{job.reference}</span>
            <Badge tone={st.tone}>{st.label}</Badge>
          </div>
          <h1 className="text-2xl sm:text-3xl">{job.service.name}</h1>
          <p className="text-[14px] text-[var(--color-ink-2)] mt-1">
            {dateTimeFull(job.scheduledStart)} – {timeOnly(job.scheduledEnd)}
          </p>
        </div>
        <div className="text-right">
          <p
            className="text-[26px] leading-none tnum"
            style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}
          >
            {money(job.priceCents, currency)}
          </p>
          <p className="ref text-[11.5px] text-[var(--color-ink-3)] mt-1">
            PROVIDER {money(job.providerPayCents, currency)}
          </p>
        </div>
      </div>

      {/* Open exceptions on this job come first — they are why you're here. */}
      {job.exceptions?.filter((e) => e.status === 'OPEN').length > 0 && (
        <div className="space-y-2.5 mb-5">
          {job.exceptions
            .filter((e) => e.status === 'OPEN')
            .map((e) => (
              <Alert key={e.id} tone="stop" title={titleCase(e.kind)}>
                <p>{e.detail}</p>
                <p className="ref text-[11.5px] mt-1 opacity-75">{dateTimeFull(e.createdAt)}</p>
                <Link to="/admin/exceptions" className="link text-[13px] mt-1.5 inline-block">
                  Resolve in the exceptions queue →
                </Link>
              </Alert>
            ))}
        </div>
      )}

      {/* ---------------------------------------------------------- actions */}
      <Card className="p-4 mb-5" ticked>
        <Eyebrow className="mb-3">Admin actions</Eyebrow>
        <div className="flex flex-wrap gap-2">
          {['OPEN', 'ASSIGNED', 'EN_ROUTE'].includes(job.status) && (
            <Button variant="ink" size="sm" onClick={openAssign} disabled={busy}>
              {job.provider ? 'Reassign provider' : 'Assign a provider'}
            </Button>
          )}
          {job.provider && ['ASSIGNED', 'EN_ROUTE'].includes(job.status) && (
            <ConfirmButton
              variant="outline"
              size="sm"
              title="Unassign this provider?"
              body={`${job.provider.businessName} will be removed and the job goes back on the board.`}
              confirmLabel="Unassign"
              needsReason
              reasonLabel="Reason"
              onConfirm={(reason) =>
                act(() => api.admin.unassign(id, reason), 'Unassigned and re-listed.')
              }
            >
              Unassign
            </ConfirmButton>
          )}

          <ChangeStatus job={job} reload={load} setError={setError} />

          {refundable && remaining > 0 && (
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                setRefundAmount((remaining / 100).toFixed(2));
                setRefundOpen(true);
              }}
            >
              Refund
            </Button>
          )}
        </div>
      </Card>

      <div className="grid md:grid-cols-[1.3fr_1fr] gap-5">
        <div className="space-y-5">
          <Card className="p-4 sm:p-5">
            <Eyebrow className="mb-3">Customer &amp; property</Eyebrow>
            <div className="rule pt-2">
              <Row label="Customer">{job.customer.fullName}</Row>
              <Row label="Email">{job.customer.email}</Row>
              {job.customer.phone && <Row label="Phone" mono>{job.customer.phone}</Row>}
              <Row label="Address">{addressLine(job.address)}</Row>
              {job.address?.notes && <Row label="Access">{job.address.notes}</Row>}
              {job.area && <Row label="Market">{`${job.area.name} · ${job.area.region}`}</Row>}
              {job.customerNotes && <Row label="Notes">{job.customerNotes}</Row>}
            </div>
          </Card>

          <Card className="p-4 sm:p-5">
            <Eyebrow className="mb-3">Provider</Eyebrow>
            {job.provider ? (
              <div className="rule pt-2">
                <Row label="Business">
                  <Link to={`/admin/providers/${job.provider.id}`} className="link">
                    {job.provider.businessName}
                  </Link>
                </Row>
                <Row label="Contact">{job.provider.user?.fullName}</Row>
                {job.provider.user?.phone && <Row label="Phone" mono>{job.provider.user.phone}</Row>}
                {job.assignedAt && <Row label="Accepted" mono>{dateTimeFull(job.assignedAt)}</Row>}
              </div>
            ) : (
              <p className="text-[var(--color-ink-3)]">
                Nobody assigned yet.
                {job.status === 'OPEN' && ' The job is live on the marketplace.'}
              </p>
            )}
          </Card>

          {job.documents?.length > 0 && (
            <Card className="p-4 sm:p-5">
              <Eyebrow className="mb-3">Documents</Eyebrow>
              <ul className="space-y-2">
                {job.documents.map((d) => (
                  <li key={d.id}>
                    <a
                      href={api.documentUrl(d.id)}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-between gap-3 py-2 px-2.5 hover:bg-[var(--color-paper-2)] transition-colors"
                      style={{ border: '1px solid var(--color-rule)' }}
                    >
                      <span className="min-w-0">
                        <span className="block text-[14px] font-semibold truncate">{d.fileName}</span>
                        <span className="ref text-[11px] text-[var(--color-ink-3)]">
                          {titleCase(d.kind)} · {bytes(d.sizeBytes)} · {dateTimeFull(d.createdAt)}
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

        <div className="space-y-5">
          <Card className="p-4 sm:p-5">
            <Eyebrow className="mb-3">Money</Eyebrow>
            <div className="rule pt-2">
              <Row label="Charged">{moneyExact(job.priceCents, currency)}</Row>
              <Row label="Payment">
                {job.payment ? (
                  <Badge tone={PAYMENT_TONE[job.payment.status]}>{titleCase(job.payment.status)}</Badge>
                ) : (
                  <span className="text-[var(--color-ink-3)]">none</span>
                )}
              </Row>
              {job.payment?.paidAt && <Row label="Paid" mono>{dateTimeFull(job.payment.paidAt)}</Row>}
              {job.payment?.refundedCents > 0 && (
                <Row label="Refunded" mono>{moneyExact(job.payment.refundedCents, currency)}</Row>
              )}
              <Row label="Provider pay">{moneyExact(job.providerPayCents, currency)}</Row>
              <Row label="Payout">
                {job.payout ? (
                  <Badge tone={PAYOUT_TONE[job.payout.status]}>{titleCase(job.payout.status)}</Badge>
                ) : (
                  <span className="text-[var(--color-ink-3)]">not due</span>
                )}
              </Row>
              <Row label="Margin">
                {moneyExact(job.priceCents - job.providerPayCents, currency)}
              </Row>
            </div>
          </Card>

          {job.events?.length > 0 && (
            <Card className="p-4 sm:p-5">
              <Eyebrow className="mb-3.5">Audit trail</Eyebrow>
              <Timeline
                items={job.events.map((e) => ({
                  title: statusTone(e.toStatus).label,
                  note: [e.note, e.actorRole && `by ${e.actorRole.toLowerCase()}`]
                    .filter(Boolean)
                    .join(' · '),
                  at: dateTimeFull(e.createdAt),
                }))}
              />
            </Card>
          )}
        </div>
      </div>

      {/* ------------------------------------------------------ assign modal */}
      <Modal open={assignOpen} onClose={() => setAssignOpen(false)} title="Assign a provider">
        {!candidates && <Loading label="Finding eligible providers" />}
        {candidates?.length === 0 && (
          <Alert tone="hold" title="No eligible providers">
            Nobody approved covers this service in this area. Add coverage on the provider, or open
            the market in Coverage.
          </Alert>
        )}
        <div className="space-y-2">
          {candidates?.map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between gap-3 p-3"
              style={{
                border: '1px solid var(--color-rule)',
                borderLeft: `3px solid ${c.available ? 'var(--color-go)' : 'var(--color-stop)'}`,
              }}
            >
              <div className="min-w-0">
                <p className="font-semibold text-[14.5px]">{c.businessName}</p>
                <p className="text-[13px] text-[var(--color-ink-3)]">
                  {c.contact.fullName}
                  {c.contact.phone && ` · ${c.contact.phone}`}
                </p>
                {!c.available && (
                  <p className="text-[12.5px] mt-0.5" style={{ color: 'var(--color-stop)' }}>
                    Already on {c.clashesWith.join(', ')} at this time
                  </p>
                )}
              </div>
              <Button
                variant={c.available ? 'primary' : 'outline'}
                size="sm"
                disabled={!c.available || busy}
                onClick={async () => {
                  await act(() => api.admin.assign(id, c.id), `Assigned to ${c.businessName}.`);
                  setAssignOpen(false);
                }}
                className="flex-none"
              >
                {c.available ? 'Assign' : 'Busy'}
              </Button>
            </div>
          ))}
        </div>
      </Modal>

      {/* ------------------------------------------------------ refund modal */}
      <Modal
        open={refundOpen}
        onClose={() => setRefundOpen(false)}
        title="Refund this payment"
        footer={
          <>
            <Button variant="quiet" onClick={() => setRefundOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={busy || !refundAmount || Number(refundAmount) <= 0}
              onClick={async () => {
                const cents = Math.round(Number(refundAmount) * 100);
                await act(
                  () => api.admin.refund(job.payment.id, cents),
                  `Refunded ${moneyExact(cents, currency)}.`,
                );
                setRefundOpen(false);
              }}
            >
              {busy ? <Spinner /> : null}
              Refund {refundAmount ? moneyExact(Math.round(Number(refundAmount) * 100), currency) : ''}
            </Button>
          </>
        }
      >
        <p className="mb-3.5 text-[14px]">
          {moneyExact(remaining, currency)} of {moneyExact(job.payment?.amountCents ?? 0, currency)}{' '}
          is still refundable on booking {job.reference}.
        </p>
        <Field label={`Amount to refund (${currency})`} hint="Leave as-is for a full refund.">
          <Input
            type="number"
            step="0.01"
            min="0.01"
            max={(remaining / 100).toFixed(2)}
            value={refundAmount}
            onChange={(e) => setRefundAmount(e.target.value)}
          />
        </Field>
        <p className="text-[13px] text-[var(--color-ink-3)] mt-3">
          The customer is not charged again, and the job is marked refunded.
        </p>
      </Modal>
    </div>
  );
}

/** Manual status override, kept behind a dropdown + confirm. */
function ChangeStatus({ job, reload, setError }) {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const go = async () => {
    setBusy(true);
    try {
      await api.admin.setJobStatus(job.id, to, note || undefined);
      setOpen(false);
      setTo('');
      setNote('');
      reload();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Change status
      </Button>
      <Modal
        open={open}
        onClose={() => !busy && setOpen(false)}
        title="Change job status"
        footer={
          <>
            <Button variant="quiet" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" onClick={go} disabled={busy || !to}>
              {busy ? <Spinner /> : null}
              Apply
            </Button>
          </>
        }
      >
        <p className="text-[14px] mb-3.5">
          Currently <strong>{statusTone(job.status).label}</strong>. Only transitions the lifecycle
          allows will be accepted — an invalid one is refused rather than forced.
        </p>
        <Field label="New status" required>
          <Select value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">Choose…</option>
            {ADMIN_STATUSES.filter((s) => s !== job.status).map((s) => (
              <option key={s} value={s}>
                {statusTone(s).label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Note for the audit trail" className="mt-3.5">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why this change" />
        </Field>
      </Modal>
    </>
  );
}
