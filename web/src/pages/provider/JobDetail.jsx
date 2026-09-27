import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import {
  addressLine,
  bytes,
  dateLong,
  dateTimeFull,
  money,
  statusTone,
  timeOnly,
  titleCase,
} from '../../lib/format.js';
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
} from '../../components/ui.jsx';
import { useJobWatch } from '../../lib/socket.js';

/** The next step a provider can take, given where the job is. */
const NEXT_ACTION = {
  ASSIGNED: { to: 'EN_ROUTE', label: "I'm on the way", hint: 'The customer gets a text when you tap this.' },
  EN_ROUTE: { to: 'IN_PROGRESS', label: "I've arrived — start job", hint: null },
  IN_PROGRESS: { to: 'COMPLETED', label: 'Mark work complete', hint: null },
};

export default function ProviderJobDetail() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const justAccepted = params.get('accepted') === '1';

  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  const load = useCallback(() => {
    setError(null);
    api.provider.job(id).then(setData).catch(setError);
  }, [id]);

  useEffect(load, [load]);
  useJobWatch(id);

  const advance = async (to) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.provider.setStatus(id, to);
      setNotice(r.message);
      load();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const uploadFiles = async (kind, files) => {
    if (!files?.length) return;
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('kind', kind);
      for (const f of files) fd.append('files', f);
      const r = await api.provider.uploadJobDocs(id, fd);
      setNotice(r.message);
      load();
    } catch (e) {
      setError(e);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const release = async (reason) => {
    await api.provider.release(id, reason);
    setNotice('Released back to the board.');
    load();
  };

  if (error && !data) return <ErrorState error={error} onRetry={load} />;
  if (!data) return <Loading label="Loading job" />;

  const { job, currency } = data;
  const st = statusTone(job.status);
  const next = NEXT_ACTION[job.status];
  const needsReport =
    job.service.requiresReport && !job.documents?.some((d) => d.kind === 'JOB_REPORT');
  const canRelease = ['ASSIGNED', 'EN_ROUTE'].includes(job.status);
  const closed = ['COMPLETED', 'CANCELLED', 'REFUNDED'].includes(job.status);

  const mapsQuery = encodeURIComponent(addressLine(job.address));

  return (
    <div className="max-w-3xl">
      <Link to="/provider/mine" className="btn btn-quiet btn-sm -ml-2 mb-3">
        ← My jobs
      </Link>

      {justAccepted && (
        <Alert tone="go" className="mb-5" title="Job accepted — it's yours">
          The full address and the customer&apos;s phone number are below. They&apos;ve been told
          you&apos;re assigned.
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

      <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
        <div>
          <div className="flex items-center gap-2.5 mb-1.5">
            <span className="ref text-[13px] text-[var(--color-ink-3)]">{job.reference}</span>
            <Badge tone={st.tone}>{st.label}</Badge>
          </div>
          <h1 className="text-2xl sm:text-3xl">{job.service.name}</h1>
        </div>
        <div className="text-right">
          <p className="eyebrow mb-0.5">You earn</p>
          <p
            className="text-[26px] leading-none tnum"
            style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}
          >
            {money(job.providerPayCents, currency)}
          </p>
        </div>
      </div>

      {/* --------------------------------------------- the on-site actions */}
      {next && (
        <Card className="p-4 mb-5" ticked>
          <Eyebrow className="mb-2.5">Next step</Eyebrow>
          <Button variant="primary" className="w-full" onClick={() => advance(next.to)} disabled={busy}>
            {busy ? <Spinner /> : null}
            {next.label}
          </Button>
          {next.hint && (
            <p className="text-[13px] text-[var(--color-ink-3)] mt-2.5 text-center">{next.hint}</p>
          )}
          {job.status === 'IN_PROGRESS' && job.service.requiresReport && (
            <p className="text-[13px] mt-2.5 text-center" style={{ color: 'var(--color-hold)' }}>
              This service needs a written report — the job stays open until you upload it.
            </p>
          )}
        </Card>
      )}

      {job.status === 'AWAITING_REPORT' && (
        <Alert tone="hold" className="mb-5" title="Report outstanding">
          The visit is logged as done. Upload the report below to close the job and release your
          payment.
        </Alert>
      )}

      <div className="grid sm:grid-cols-2 gap-5">
        {/* ---------------------------------------------------- site card */}
        <Card className="p-4 sm:p-5">
          <Eyebrow className="mb-2.5">Appointment</Eyebrow>
          <p className="text-[16px] font-semibold" style={{ fontFamily: 'var(--font-display)' }}>
            {dateLong(job.scheduledStart)}
          </p>
          <p className="text-[15px] text-[var(--color-ink-2)] mb-3.5">
            {timeOnly(job.scheduledStart)} – {timeOnly(job.scheduledEnd)}
          </p>

          <div className="rule pt-2.5">
            <Eyebrow className="mb-1.5">Address</Eyebrow>
            <p className="text-[15px] mb-2.5">{addressLine(job.address)}</p>
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${mapsQuery}`}
              target="_blank"
              rel="noreferrer"
              className="btn btn-outline btn-sm"
            >
              Open in maps ↗
            </a>
          </div>

          {job.address?.notes && (
            <div className="rule mt-3.5 pt-2.5">
              <Eyebrow className="mb-1">Access notes</Eyebrow>
              <p className="text-[14px]">{job.address.notes}</p>
            </div>
          )}
        </Card>

        {/* ------------------------------------------------- customer card */}
        <Card className="p-4 sm:p-5">
          <Eyebrow className="mb-2.5">Customer</Eyebrow>
          <p className="text-[16px] font-semibold" style={{ fontFamily: 'var(--font-display)' }}>
            {job.customer.fullName}
          </p>
          {job.customer.phone && !closed && (
            <a href={`tel:${job.customer.phone}`} className="btn btn-outline btn-sm mt-3">
              Call {job.customer.phone}
            </a>
          )}

          {job.customerNotes && (
            <div className="rule mt-3.5 pt-2.5">
              <Eyebrow className="mb-1">What they asked for</Eyebrow>
              <p className="text-[14px]">“{job.customerNotes}”</p>
            </div>
          )}
        </Card>
      </div>

      {/* ------------------------------------------------------- documents */}
      {!closed || job.documents?.length > 0 ? (
        <Card className="p-4 sm:p-5 mt-5">
          <Eyebrow className="mb-3">Report &amp; photos</Eyebrow>

          {job.documents?.length > 0 && (
            <ul className="space-y-2 mb-4">
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
          )}

          {!closed && (
            <>
              <input
                ref={fileRef}
                type="file"
                multiple
                accept="application/pdf,image/jpeg,image/png,image/webp,image/heic"
                className="hidden"
                onChange={(e) => uploadFiles(e.target.dataset.kind || 'JOB_REPORT', e.target.files)}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  variant={needsReport ? 'primary' : 'outline'}
                  disabled={uploading}
                  onClick={() => {
                    fileRef.current.dataset.kind = 'JOB_REPORT';
                    fileRef.current.click();
                  }}
                >
                  {uploading ? <Spinner /> : null}
                  {needsReport ? 'Upload the report' : 'Add another report'}
                </Button>
                <Button
                  variant="outline"
                  disabled={uploading}
                  onClick={() => {
                    fileRef.current.dataset.kind = 'JOB_PHOTO';
                    fileRef.current.click();
                  }}
                >
                  Add photos
                </Button>
              </div>
              <p className="text-[12.5px] text-[var(--color-ink-3)] mt-2.5">
                PDF or photos, up to 15 MB each. Take them on your phone and upload straight from
                site.
              </p>
            </>
          )}
        </Card>
      ) : null}

      {/* --------------------------------------------------------- history */}
      {job.events?.length > 0 && (
        <Card className="p-4 sm:p-5 mt-5">
          <Eyebrow className="mb-3.5">History</Eyebrow>
          <Timeline
            items={job.events.map((e) => ({
              title: statusTone(e.toStatus).label,
              note: e.note,
              at: dateTimeFull(e.createdAt),
            }))}
          />
        </Card>
      )}

      {/* --------------------------------------------------- payout status */}
      {job.payout && (
        <Card className="p-4 sm:p-5 mt-5">
          <Eyebrow className="mb-2.5">Your payment</Eyebrow>
          <div className="rule pt-2">
            <Row label="Amount">{money(job.payout.amountCents, currency)}</Row>
            <Row label="Status">
              <Badge tone={job.payout.status === 'PAID' ? 'badge-go' : 'badge-hold'}>
                {titleCase(job.payout.status)}
              </Badge>
            </Row>
            {job.payout.paidAt && (
              <Row label="Sent" mono>
                {dateTimeFull(job.payout.paidAt)}
              </Row>
            )}
          </div>
        </Card>
      )}

      {canRelease && (
        <Card className="p-4 sm:p-5 mt-5">
          <Eyebrow className="mb-2">Can&apos;t make it?</Eyebrow>
          <p className="text-[13.5px] text-[var(--color-ink-2)] mb-3">
            Release it back to the board as early as you can so someone else can pick it up. The
            customer is notified and our team sees it.
          </p>
          <ConfirmButton
            variant="danger"
            size="sm"
            title="Release this job?"
            body={`${job.reference} — ${job.service.name} on ${dateTimeFull(job.scheduledStart)}.`}
            confirmLabel="Release job"
            needsReason
            reasonLabel="Why are you releasing it?"
            onConfirm={release}
          >
            Release this job
          </ConfirmButton>
        </Card>
      )}
    </div>
  );
}
