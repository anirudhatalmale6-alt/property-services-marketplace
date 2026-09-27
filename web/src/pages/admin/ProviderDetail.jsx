import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import {
  bytes,
  dateTimeFull,
  money,
  statusTone,
  titleCase,
  PAYOUT_TONE,
  PROVIDER_TONE,
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
  Loading,
  Modal,
  Row,
  Spinner,
  Textarea,
} from '../../components/ui.jsx';

const DOC_LABEL = {
  IDENTITY: 'Photo ID',
  LICENSE: 'Trade license',
  INSURANCE: 'Public liability insurance',
  OTHER: 'Other document',
};

export default function AdminProviderDetail() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectNotes, setRejectNotes] = useState('');

  const load = useCallback(() => {
    setError(null);
    api.admin.provider(id).then(setData).catch(setError);
  }, [id]);

  useEffect(load, [load]);

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

  if (error && !data) return <ErrorState error={error} onRetry={load} />;
  if (!data) return <Loading label="Loading provider" />;

  const { provider: p, currency } = data;
  const onboardingDocs = p.documents.filter((d) => d.kind !== 'JOB_REPORT' && d.kind !== 'JOB_PHOTO');
  const kinds = new Set(onboardingDocs.map((d) => d.kind));
  const missing = ['IDENTITY', 'LICENSE', 'INSURANCE'].filter((k) => !kinds.has(k));
  const blockers = [
    ...missing.map((k) => `missing ${DOC_LABEL[k].toLowerCase()}`),
    p.services.length === 0 && 'no services selected',
    p.areas.length === 0 && 'no service areas selected',
  ].filter(Boolean);

  return (
    <div className="max-w-5xl">
      <Link to="/admin/providers" className="btn btn-quiet btn-sm -ml-2 mb-3">
        ← All providers
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
            <Badge tone={PROVIDER_TONE[p.status]}>{titleCase(p.status)}</Badge>
            {!p.user.isActive && <Badge tone="badge-stop">Account disabled</Badge>}
          </div>
          <h1 className="text-2xl sm:text-3xl">{p.businessName}</h1>
          <p className="text-[14.5px] text-[var(--color-ink-2)] mt-1">
            {p.user.fullName} · {p.user.email}
            {p.user.phone && ` · ${p.user.phone}`}
          </p>
        </div>
      </div>

      {/* --------------------------------------------------------- decision */}
      <Card className="p-4 mb-5" ticked>
        <Eyebrow className="mb-3">Verification decision</Eyebrow>

        {blockers.length > 0 && p.status !== 'APPROVED' && (
          <Alert tone="hold" className="mb-3.5" title="Cannot approve yet">
            This application has {blockers.join(', ')}. Approving a provider with no services or
            areas would create an account that can never be matched to a job.
          </Alert>
        )}

        <div className="flex flex-wrap gap-2">
          {p.status !== 'APPROVED' && (
            <ConfirmButton
              variant="primary"
              size="sm"
              title={`Approve ${p.businessName}?`}
              body="They'll be emailed and texted, and can start accepting jobs immediately."
              confirmLabel="Approve provider"
              onConfirm={() => act(() => api.admin.reviewProvider(p.id, 'APPROVED'), 'Provider approved.')}
            >
              Approve
            </ConfirmButton>
          )}

          {p.status !== 'REJECTED' && (
            <Button variant="danger" size="sm" onClick={() => setRejectOpen(true)} disabled={busy}>
              Reject
            </Button>
          )}

          {p.status === 'APPROVED' && (
            <ConfirmButton
              variant="danger"
              size="sm"
              title={`Suspend ${p.businessName}?`}
              body="They keep their account but cannot see or accept new jobs. Work already accepted is unaffected."
              confirmLabel="Suspend"
              needsReason
              reasonLabel="Reason"
              onConfirm={(reason) =>
                act(() => api.admin.reviewProvider(p.id, 'SUSPENDED', reason), 'Provider suspended.')
              }
            >
              Suspend
            </ConfirmButton>
          )}

          {p.status === 'SUSPENDED' && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => act(() => api.admin.reviewProvider(p.id, 'APPROVED'), 'Provider reinstated.')}
            >
              Reinstate
            </Button>
          )}

          <ConfirmButton
            variant="outline"
            size="sm"
            title={p.user.isActive ? 'Disable this account?' : 'Re-enable this account?'}
            body={
              p.user.isActive
                ? 'They will be signed out everywhere and unable to log in.'
                : 'They will be able to sign in again.'
            }
            confirmLabel={p.user.isActive ? 'Disable account' : 'Re-enable account'}
            onConfirm={() =>
              act(
                () => api.admin.setUserActive(p.user.id, !p.user.isActive),
                p.user.isActive ? 'Account disabled.' : 'Account re-enabled.',
              )
            }
          >
            {p.user.isActive ? 'Disable login' : 'Re-enable login'}
          </ConfirmButton>
        </div>

        {p.reviewNotes && (
          <p className="text-[13.5px] text-[var(--color-ink-2)] mt-3.5 rule pt-2.5">
            <strong>Last review note:</strong> {p.reviewNotes}
            {p.reviewedAt && (
              <span className="ref text-[11.5px] text-[var(--color-ink-3)] block mt-0.5">
                {dateTimeFull(p.reviewedAt)}
              </span>
            )}
          </p>
        )}
      </Card>

      <div className="grid md:grid-cols-[1.3fr_1fr] gap-5">
        <div className="space-y-5">
          {/* ------------------------------------------------- documents */}
          <Card className="p-4 sm:p-5">
            <Eyebrow className="mb-3">Documents</Eyebrow>

            {onboardingDocs.length === 0 ? (
              <p className="text-[var(--color-ink-3)]">Nothing uploaded yet.</p>
            ) : (
              <div className="space-y-2.5">
                {onboardingDocs.map((d) => (
                  <div
                    key={d.id}
                    className="p-3"
                    style={{
                      border: '1px solid var(--color-rule)',
                      borderLeft: `3px solid ${
                        d.reviewState === 'APPROVED'
                          ? 'var(--color-go)'
                          : d.reviewState === 'REJECTED'
                            ? 'var(--color-stop)'
                            : 'var(--color-hold)'
                      }`,
                    }}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-[14.5px]">
                            {DOC_LABEL[d.kind] ?? titleCase(d.kind)}
                          </p>
                          <Badge
                            tone={
                              d.reviewState === 'APPROVED'
                                ? 'badge-go'
                                : d.reviewState === 'REJECTED'
                                  ? 'badge-stop'
                                  : 'badge-hold'
                            }
                          >
                            {titleCase(d.reviewState)}
                          </Badge>
                          {d.expiresAt && new Date(d.expiresAt) < new Date() && (
                            <Badge tone="badge-stop">Expired</Badge>
                          )}
                        </div>
                        <p className="ref text-[11.5px] text-[var(--color-ink-3)] mt-1">
                          {d.fileName} · {bytes(d.sizeBytes)} · uploaded {dateTimeFull(d.createdAt)}
                          {d.expiresAt && ` · expires ${dateTimeFull(d.expiresAt)}`}
                        </p>
                        {d.reviewNotes && (
                          <p className="text-[13px] mt-1" style={{ color: 'var(--color-stop)' }}>
                            {d.reviewNotes}
                          </p>
                        )}
                      </div>

                      <div className="flex gap-1.5 flex-none">
                        <a
                          href={api.documentUrl(d.id)}
                          target="_blank"
                          rel="noreferrer"
                          className="btn btn-outline btn-sm"
                        >
                          View ↗
                        </a>
                        {d.reviewState !== 'APPROVED' && (
                          <Button
                            variant="quiet"
                            size="sm"
                            disabled={busy}
                            onClick={() =>
                              act(() => api.admin.reviewDocument(d.id, 'APPROVED'), 'Document approved.')
                            }
                          >
                            ✓
                          </Button>
                        )}
                        {d.reviewState !== 'REJECTED' && (
                          <ConfirmButton
                            variant="danger"
                            size="sm"
                            title="Reject this document?"
                            body="The provider is asked to upload a replacement."
                            confirmLabel="Reject document"
                            needsReason
                            reasonLabel="What's wrong with it?"
                            onConfirm={(reason) =>
                              act(
                                () => api.admin.reviewDocument(d.id, 'REJECTED', reason),
                                'Document rejected.',
                              )
                            }
                          >
                            ✕
                          </ConfirmButton>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {missing.length > 0 && (
              <p className="text-[13.5px] mt-3.5 rule pt-2.5" style={{ color: 'var(--color-hold)' }}>
                Still to provide: {missing.map((k) => DOC_LABEL[k].toLowerCase()).join(', ')}.
              </p>
            )}
          </Card>

          {/* ------------------------------------------------- recent jobs */}
          <Card>
            <div className="p-4 border-b">
              <Eyebrow>Recent jobs</Eyebrow>
            </div>
            {p.jobs.length === 0 ? (
              <p className="p-4 text-[var(--color-ink-3)]">No jobs yet.</p>
            ) : (
              <div className="table-scroll">
                <table className="dtable">
                  <thead>
                    <tr>
                      <th>Ref</th>
                      <th>When</th>
                      <th>Status</th>
                      <th className="text-right">Pay</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.jobs.map((j) => (
                      <tr key={j.id}>
                        <td>
                          <Link to={`/admin/jobs/${j.id}`} className="ref text-[12.5px] link">
                            {j.reference}
                          </Link>
                        </td>
                        <td className="ref text-[12px] whitespace-nowrap">
                          {dateTimeFull(j.scheduledStart)}
                        </td>
                        <td>
                          <Badge tone={statusTone(j.status).tone}>{statusTone(j.status).label}</Badge>
                        </td>
                        <td className="text-right ref">{money(j.providerPayCents, currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        {/* --------------------------------------------------------- side */}
        <div className="space-y-5">
          <Card className="p-4 sm:p-5">
            <Eyebrow className="mb-3">Details</Eyebrow>
            <div className="rule pt-2">
              <Row label="ABN / license" mono>
                {p.legalName || '—'}
              </Row>
              <Row label="Joined" mono>
                {dateTimeFull(p.user.createdAt)}
              </Row>
              <Row label="Submitted" mono>
                {p.submittedAt ? dateTimeFull(p.submittedAt) : '—'}
              </Row>
              <Row label="Payout account" mono>
                {p.payoutRef ? p.payoutRef : <span className="text-[var(--color-hold)]">not connected</span>}
              </Row>
            </div>
            {p.bio && (
              <p className="text-[14px] text-[var(--color-ink-2)] mt-3.5 rule pt-2.5">{p.bio}</p>
            )}
          </Card>

          <Card className="p-4 sm:p-5">
            <Eyebrow className="mb-2.5">Services ({p.services.length})</Eyebrow>
            {p.services.length === 0 ? (
              <p className="text-[13.5px]" style={{ color: 'var(--color-hold)' }}>
                None selected — cannot be matched to work.
              </p>
            ) : (
              <ul className="space-y-1 text-[14px]">
                {p.services.map((s) => (
                  <li key={s.id}>· {s.name}</li>
                ))}
              </ul>
            )}

            <Eyebrow className="mb-2.5 mt-4">Areas ({p.areas.length})</Eyebrow>
            {p.areas.length === 0 ? (
              <p className="text-[13.5px]" style={{ color: 'var(--color-hold)' }}>
                None selected — cannot be matched to work.
              </p>
            ) : (
              <ul className="space-y-1 text-[14px]">
                {p.areas.map((a) => (
                  <li key={a.id}>
                    · {a.name} <span className="text-[var(--color-ink-3)]">({a.state})</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {p.payouts.length > 0 && (
            <Card className="p-4 sm:p-5">
              <Eyebrow className="mb-3">Payouts</Eyebrow>
              <ul className="space-y-2">
                {p.payouts.map((po) => (
                  <li key={po.id} className="flex items-center justify-between gap-3 text-[13.5px]">
                    <Badge tone={PAYOUT_TONE[po.status]}>{titleCase(po.status)}</Badge>
                    <span className="ref">{money(po.amountCents, currency)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>

      {/* -------------------------------------------------------- reject modal */}
      <Modal
        open={rejectOpen}
        onClose={() => !busy && setRejectOpen(false)}
        title={`Reject ${p.businessName}?`}
        footer={
          <>
            <Button variant="quiet" onClick={() => setRejectOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={busy || rejectNotes.trim().length < 5}
              onClick={async () => {
                await act(
                  () => api.admin.reviewProvider(p.id, 'REJECTED', rejectNotes.trim()),
                  'Provider rejected and notified.',
                );
                setRejectOpen(false);
                setRejectNotes('');
              }}
            >
              {busy ? <Spinner /> : null}
              Reject and notify
            </Button>
          </>
        }
      >
        <p className="text-[14px] mb-3.5">
          This reason is emailed to the provider, so write it as something they can act on.
        </p>
        <Field label="Reason" required>
          <Textarea
            rows={4}
            value={rejectNotes}
            onChange={(e) => setRejectNotes(e.target.value)}
            placeholder="e.g. The insurance certificate expired in March — please upload a current certificate of currency."
          />
        </Field>
      </Modal>
    </div>
  );
}
