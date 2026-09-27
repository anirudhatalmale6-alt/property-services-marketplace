import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { dateTimeFull, relative, statusTone, titleCase } from '../../lib/format.js';
import {
  Alert,
  Badge,
  Button,
  Card,
  Empty,
  ErrorState,
  Eyebrow,
  Field,
  Loading,
  Modal,
  PageHead,
  Spinner,
  Textarea,
} from '../../components/ui.jsx';
import { useSocketEvent } from '../../lib/socket.js';

/** What each exception kind actually means, and what to do about it. */
const KIND_HELP = {
  PAYMENT_FAILED: "The customer's card was declined. They keep the booking but it isn't confirmed.",
  NO_PROVIDER_FOUND: 'Nobody approved covers this service in this area. Assign manually or recruit.',
  JOB_OVERDUE: 'The appointment time has passed without the job being completed.',
  REPORT_MISSING: 'Work marked done but the required report was never uploaded. Payout is held.',
  PAYOUT_FAILED: "Sending the provider's payment failed. Check their payout details.",
  REFUND_REQUESTED: 'Cancelled inside the free window — someone needs to decide on the refund.',
  PROVIDER_CANCELLED: 'A provider dropped the job after accepting it. It is back on the board.',
  OTHER: 'Needs a look.',
};

const KIND_TONE = {
  PAYMENT_FAILED: 'badge-stop',
  PAYOUT_FAILED: 'badge-stop',
  NO_PROVIDER_FOUND: 'badge-stop',
  JOB_OVERDUE: 'badge-hold',
  REPORT_MISSING: 'badge-hold',
  REFUND_REQUESTED: 'badge-hold',
  PROVIDER_CANCELLED: 'badge-hold',
  OTHER: 'badge-mute',
};

const FILTERS = [
  ['OPEN', 'Open'],
  ['RESOLVED', 'Resolved'],
  ['DISMISSED', 'Dismissed'],
  ['ALL', 'Everything'],
];

export default function AdminExceptions() {
  const [status, setStatus] = useState('OPEN');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const [active, setActive] = useState(null);
  const [resolution, setResolution] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setError(null);
    api.admin.exceptions({ status, perPage: 50 }).then(setData).catch(setError);
  }, [status]);

  useEffect(() => {
    setData(null);
    load();
  }, [load]);

  useSocketEvent('exception:raised', () => status === 'OPEN' && load());

  const resolve = async (dismiss) => {
    setBusy(true);
    setError(null);
    try {
      await api.admin.resolveException(active.id, resolution.trim(), dismiss);
      setNotice(dismiss ? 'Dismissed.' : 'Marked resolved.');
      setActive(null);
      setResolution('');
      load();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHead
        eyebrow="Operations"
        title="Exceptions"
        sub="Anything the platform couldn't resolve on its own. Every entry needs a human decision."
      />

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

      <div className="flex gap-2 mb-5 flex-wrap">
        {FILTERS.map(([v, label]) => (
          <button key={v} onClick={() => setStatus(v)} className={`chip px-3 ${status === v ? 'chip-on' : ''}`}>
            {label}
          </button>
        ))}
      </div>

      {!data && !error && <Loading label="Loading exceptions" />}

      {data && data.exceptions.length === 0 && (
        <Card className="p-2">
          <Empty title={status === 'OPEN' ? 'Nothing needs attention' : 'Nothing here'}>
            {status === 'OPEN'
              ? 'Failed payments, unfilled jobs, missing reports and refund requests all land here automatically.'
              : null}
          </Empty>
        </Card>
      )}

      <div className="space-y-3">
        {data?.exceptions.map((e, i) => (
          <Card
            key={e.id}
            className="p-4 rise"
            style={{
              borderLeft: `3px solid ${
                e.status !== 'OPEN'
                  ? 'var(--color-rule-strong)'
                  : KIND_TONE[e.kind] === 'badge-stop'
                    ? 'var(--color-stop)'
                    : 'var(--color-hold)'
              }`,
              animationDelay: `${i * 40}ms`,
            }}
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap mb-1.5">
                  <Badge tone={e.status === 'OPEN' ? KIND_TONE[e.kind] : 'badge-mute'}>
                    {titleCase(e.kind)}
                  </Badge>
                  {e.status !== 'OPEN' && <Badge tone="badge-go">{titleCase(e.status)}</Badge>}
                  {e.job && (
                    <Link to={`/admin/jobs/${e.job.id}`} className="ref text-[12px] link">
                      {e.job.reference}
                    </Link>
                  )}
                  <span className="ref text-[11.5px] text-[var(--color-ink-3)]">
                    {relative(e.createdAt)}
                  </span>
                </div>

                <p className="text-[15px]">{e.detail}</p>
                <p className="text-[13px] text-[var(--color-ink-3)] mt-1">{KIND_HELP[e.kind]}</p>

                {e.job && (
                  <p className="text-[13px] text-[var(--color-ink-2)] mt-2">
                    {e.job.service.name} · {e.job.customer.fullName}
                    {e.job.customer.phone && ` · ${e.job.customer.phone}`} ·{' '}
                    <span className="ref">{statusTone(e.job.status).label}</span>
                  </p>
                )}

                {e.status !== 'OPEN' && e.resolution && (
                  <p className="text-[13.5px] mt-2.5 rule pt-2" style={{ color: 'var(--color-go)' }}>
                    {e.resolution}
                    {e.resolvedBy && ` — ${e.resolvedBy.fullName}`}
                    {e.resolvedAt && (
                      <span className="ref text-[11.5px] text-[var(--color-ink-3)] block mt-0.5">
                        {dateTimeFull(e.resolvedAt)}
                      </span>
                    )}
                  </p>
                )}
              </div>

              <div className="flex gap-2 flex-none">
                {e.job && (
                  <Link to={`/admin/jobs/${e.job.id}`} className="btn btn-outline btn-sm">
                    Open job
                  </Link>
                )}
                {e.status === 'OPEN' && (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => {
                      setActive(e);
                      setResolution('');
                    }}
                  >
                    Resolve
                  </Button>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Modal
        open={Boolean(active)}
        onClose={() => !busy && setActive(null)}
        title={active ? titleCase(active.kind) : ''}
        footer={
          <>
            <Button variant="quiet" onClick={() => setActive(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="outline"
              onClick={() => resolve(true)}
              disabled={busy || resolution.trim().length < 2}
            >
              Dismiss
            </Button>
            <Button
              variant="primary"
              onClick={() => resolve(false)}
              disabled={busy || resolution.trim().length < 2}
            >
              {busy ? <Spinner /> : null}
              Mark resolved
            </Button>
          </>
        }
      >
        {active && (
          <>
            <p className="text-[14px] mb-1">{active.detail}</p>
            <p className="text-[13px] text-[var(--color-ink-3)] mb-4">{KIND_HELP[active.kind]}</p>

            <Field
              label="What did you do?"
              required
              hint="Recorded permanently against this exception, so the next person knows."
            >
              <Textarea
                rows={3}
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
                placeholder="e.g. Called the customer, re-took payment on a different card."
              />
            </Field>

            <p className="text-[12.5px] text-[var(--color-ink-3)] mt-3">
              <strong>Resolved</strong> means it was dealt with. <strong>Dismissed</strong> means it
              didn&apos;t need action.
            </p>
          </>
        )}
      </Modal>
    </div>
  );
}
