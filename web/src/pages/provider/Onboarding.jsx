import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { bytes, dateTimeFull, money, titleCase } from '../../lib/format.js';
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
  Select,
  Spinner,
  Textarea,
} from '../../components/ui.jsx';

const REQUIRED_DOCS = [
  ['IDENTITY', 'Photo ID', 'Driver license or passport.'],
  ['LICENSE', 'Trade license', 'Your QBCC / trade license or equivalent registration.'],
  ['INSURANCE', 'Public liability insurance', 'Certificate of currency showing the expiry date.'],
];

export default function Onboarding() {
  const { user, reload } = useAuth();
  const navigate = useNavigate();

  const [data, setData] = useState(null);
  const [catalog, setCatalog] = useState(null);
  const [areas, setAreas] = useState([]);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  const [profile, setProfile] = useState({ businessName: '', legalName: '', bio: '' });
  const [credentials, setCredentials] = useState([]);
  const [serviceIds, setServiceIds] = useState([]);
  const [areaIds, setAreaIds] = useState([]);
  const [uploadingKind, setUploadingKind] = useState(null);
  const fileRef = useRef(null);

  const load = useCallback(() => {
    setError(null);
    Promise.all([api.provider.me(), api.catalog.services(), api.catalog.areas()])
      .then(([me, cat, ar]) => {
        setData(me);
        setCatalog(cat);
        setAreas(ar.areas);
        setProfile({
          businessName: me.profile.businessName || '',
          legalName: me.profile.legalName || '',
          bio: me.profile.bio || '',
        });
        setServiceIds(me.profile.services.map((s) => s.id));
        setAreaIds(me.profile.areas.map((a) => a.id));
        setCredentials(
          (me.profile.credentials ?? []).map((c) => ({
            id: c.id,
            kind: c.kind,
            jurisdiction: c.jurisdiction ?? '',
            number: c.number,
            issuedBy: c.issuedBy ?? '',
            expiresAt: c.expiresAt ? c.expiresAt.slice(0, 10) : '',
            reviewState: c.reviewState,
          })),
        );
      })
      .catch(setError);
  }, []);

  useEffect(load, [load]);

  const toggle = (list, setList, id) =>
    setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const saveProfile = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.provider.updateMe(profile);
      setNotice('Details saved.');
      load();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const saveCredentials = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.provider.setCredentials(
        credentials.map((c) => ({
          ...(c.id ? { id: c.id } : {}),
          kind: c.kind,
          ...(c.jurisdiction ? { jurisdiction: c.jurisdiction.toUpperCase() } : {}),
          number: c.number.trim(),
          ...(c.issuedBy.trim() ? { issuedBy: c.issuedBy.trim() } : {}),
          ...(c.expiresAt ? { expiresAt: new Date(`${c.expiresAt}T12:00:00Z`).toISOString() } : {}),
        })),
      );
      setNotice('Credentials saved.');
      load();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const saveCoverage = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.provider.setCoverage(serviceIds, areaIds);
      setNotice('Services and areas saved.');
      load();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const upload = async (kind, file) => {
    if (!file) return;
    setUploadingKind(kind);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('kind', kind);
      fd.append('file', file);
      await api.provider.uploadDoc(fd);
      setNotice(`${titleCase(kind)} uploaded.`);
      load();
    } catch (e) {
      setError(e);
    } finally {
      setUploadingKind(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.provider.submit();
      setNotice(r.message);
      await reload();
      load();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  if (error && !data) return <ErrorState error={error} onRetry={load} />;
  if (!data || !catalog) return <Loading label="Loading your application" />;

  const { profile: p, onboarding } = data;
  const status = p.status;
  const locked = status === 'PENDING' || status === 'APPROVED';

  // If they got approved while sitting on this page, get them to work.
  if (status === 'APPROVED') {
    return (
      <div className="max-w-2xl mx-auto pt-4">
        <Card className="p-6 text-center" ticked>
          <span className="badge badge-go mb-3 inline-flex">Approved</span>
          <h1 className="text-2xl mb-2">You&apos;re verified and ready to work</h1>
          <p className="text-[var(--color-ink-2)] mb-5">
            Your documents have been checked. Jobs in your areas are on the board now.
          </p>
          <Button variant="primary" onClick={() => navigate('/provider/jobs')}>
            Go to the job board →
          </Button>
        </Card>
      </div>
    );
  }

  const docFor = (kind) => p.documents.find((d) => d.kind === kind && d.reviewState !== 'REJECTED');
  const rejectedFor = (kind) => p.documents.find((d) => d.kind === kind && d.reviewState === 'REJECTED');

  return (
    <div className="max-w-3xl">
      <Eyebrow className="mb-1.5">Provider onboarding</Eyebrow>
      <h1 className="text-2xl sm:text-3xl mb-2">Get verified</h1>
      <p className="text-[var(--color-ink-2)] mb-6 max-w-2xl">
        Three things and you&apos;re done: tell us what you do, where you work, and prove you&apos;re
        licensed and insured. Our team reviews it and you&apos;re on the board.
      </p>

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

      {status === 'PENDING' && (
        <Alert tone="info" className="mb-5" title="Your application is under review">
          Submitted {p.submittedAt ? dateTimeFull(p.submittedAt) : 'recently'}. We usually come back
          within one business day — we&apos;ll email and text you. Nothing more to do for now.
        </Alert>
      )}

      {status === 'REJECTED' && (
        <Alert tone="stop" className="mb-5" title="Your application wasn't approved">
          {p.reviewNotes || 'Our team could not verify your documents.'}
          <p className="mt-1.5">Update what&apos;s needed below and submit again.</p>
        </Alert>
      )}

      <input
        ref={fileRef}
        type="file"
        className="hidden"
        accept="application/pdf,image/jpeg,image/png,image/webp,image/heic"
        onChange={(e) => upload(e.target.dataset.kind, e.target.files?.[0])}
      />

      <div className="space-y-5">
        {/* --------------------------------------------------- 1. business */}
        <Card className="p-4 sm:p-5">
          <div className="flex items-center gap-2.5 mb-4">
            <span className="step-dot step-dot-done">1</span>
            <h2 className="text-lg">Your business</h2>
          </div>

          <div className="grid gap-4">
            <Field label="Business / trading name" required>
              <Input
                value={profile.businessName}
                onChange={(e) => setProfile({ ...profile, businessName: e.target.value })}
                disabled={locked}
              />
            </Field>
            <Field label="ABN or license number" hint="Shown to our team during verification.">
              <Input
                value={profile.legalName}
                onChange={(e) => setProfile({ ...profile, legalName: e.target.value })}
                disabled={locked}
              />
            </Field>
            <Field label="About you" hint="A line or two on your experience. Customers see this.">
              <Textarea
                rows={3}
                value={profile.bio}
                onChange={(e) => setProfile({ ...profile, bio: e.target.value })}
                disabled={locked}
              />
            </Field>
            {!locked && (
              <Button variant="outline" onClick={saveProfile} disabled={busy} className="justify-self-start">
                {busy ? <Spinner /> : null}
                Save details
              </Button>
            )}
          </div>
        </Card>

        {/* -------------------------------------------- 2. services & areas */}
        <Card className="p-4 sm:p-5">
          <div className="flex items-center gap-2.5 mb-1.5">
            <span className={`step-dot ${onboarding.hasServices && onboarding.hasAreas ? 'step-dot-done' : 'step-dot-active'}`}>
              2
            </span>
            <h2 className="text-lg">What you do, and where</h2>
          </div>
          <p className="text-[13.5px] text-[var(--color-ink-3)] mb-4 ml-9">
            You&apos;ll only ever be shown jobs that match both.
          </p>

          <Eyebrow className="mb-2.5">Services you offer</Eyebrow>
          <div className="space-y-2 mb-5">
            {catalog.categories.flatMap((c) =>
              c.services.map((s) => {
                const on = serviceIds.includes(s.id);
                return (
                  <button
                    key={s.id}
                    disabled={locked}
                    onClick={() => toggle(serviceIds, setServiceIds, s.id)}
                    className={`pick ${on ? 'pick-on' : ''} disabled:opacity-60`}
                    style={{ padding: '0.7rem 0.85rem' }}
                  >
                    {/*
                      Deliberately no pay figure here: the public catalogue
                      exposes the customer price, not the provider rate, and
                      deriving one from the other would be inventing a number.
                      The exact pay is on every job card on the board.
                    */}
                    <div className="min-w-0">
                      <p className="font-semibold text-[14.5px]">
                        {on ? '☑' : '☐'} {s.name}
                      </p>
                      <p className="ref text-[11.5px] text-[var(--color-ink-3)] mt-0.5">{c.name}</p>
                    </div>
                  </button>
                );
              }),
            )}
          </div>

          <Eyebrow className="mb-2.5">Areas you cover</Eyebrow>
          <div className="grid sm:grid-cols-2 gap-2 mb-4">
            {areas.map((a) => {
              const on = areaIds.includes(a.id);
              return (
                <button
                  key={a.id}
                  disabled={locked}
                  onClick={() => toggle(areaIds, setAreaIds, a.id)}
                  className={`pick ${on ? 'pick-on' : ''} disabled:opacity-60`}
                  style={{ padding: '0.6rem 0.8rem' }}
                >
                  <p className="font-semibold text-[14px]">
                    {on ? '☑' : '☐'} {a.name}
                  </p>
                  <p className="ref text-[11.5px] text-[var(--color-ink-3)]">
                    {a.zip} · {a.city}, {a.state}
                  </p>
                </button>
              );
            })}
          </div>

          {!locked && (
            <Button
              variant="outline"
              onClick={saveCoverage}
              disabled={busy || serviceIds.length === 0 || areaIds.length === 0}
            >
              {busy ? <Spinner /> : null}
              Save services &amp; areas
            </Button>
          )}
        </Card>

        {/* --------------------------------------- 3. licenses per state */}
        <Card className="p-4 sm:p-5">
          <div className="flex items-center gap-2.5 mb-1.5">
            <span
              className={`step-dot ${
                (onboarding.statesMissingLicense ?? []).length === 0 && credentials.length > 0
                  ? 'step-dot-done'
                  : 'step-dot-active'
              }`}
            >
              3
            </span>
            <h2 className="text-lg">Licenses &amp; insurance</h2>
          </div>
          <p className="text-[13.5px] text-[var(--color-ink-3)] mb-4 ml-9">
            One license per state you work in. Requirements differ state to state, so add each one
            separately.
          </p>

          {(onboarding.statesMissingLicense ?? []).length > 0 && (
            <Alert tone="hold" className="mb-4" title="A state is missing its license">
              You&apos;ve chosen to work in{' '}
              <strong>{onboarding.statesMissingLicense.join(', ')}</strong> but haven&apos;t added a
              license for {onboarding.statesMissingLicense.length === 1 ? 'it' : 'them'} yet.
            </Alert>
          )}

          <div className="space-y-3">
            {credentials.map((c, i) => (
              <div
                key={c.id ?? `new-${i}`}
                className="p-3.5"
                style={{
                  border: '1px solid var(--color-rule)',
                  borderLeft: `3px solid ${
                    c.reviewState === 'APPROVED'
                      ? 'var(--color-go)'
                      : c.reviewState === 'REJECTED'
                        ? 'var(--color-stop)'
                        : 'var(--color-rule-strong)'
                  }`,
                }}
              >
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2">
                    {c.reviewState && (
                      <Badge
                        tone={
                          c.reviewState === 'APPROVED'
                            ? 'badge-go'
                            : c.reviewState === 'REJECTED'
                              ? 'badge-stop'
                              : 'badge-hold'
                        }
                      >
                        {titleCase(c.reviewState)}
                      </Badge>
                    )}
                  </div>
                  {!locked && (
                    <Button
                      variant="quiet"
                      size="sm"
                      onClick={() => setCredentials((prev) => prev.filter((_, j) => j !== i))}
                    >
                      Remove
                    </Button>
                  )}
                </div>

                <div className="grid sm:grid-cols-2 gap-3.5">
                  <Field label="Type" required>
                    <Select
                      value={c.kind}
                      disabled={locked}
                      onChange={(e) =>
                        setCredentials((prev) =>
                          prev.map((x, j) => (j === i ? { ...x, kind: e.target.value } : x)),
                        )
                      }
                    >
                      <option value="LICENSE">State license</option>
                      <option value="CERTIFICATION">Certification</option>
                      <option value="INSURANCE">Insurance</option>
                      <option value="BOND">Bond</option>
                      <option value="OTHER">Other</option>
                    </Select>
                  </Field>

                  <Field
                    label="State"
                    required={c.kind === 'LICENSE'}
                    hint={c.kind === 'LICENSE' ? undefined : 'Leave blank if not state-specific.'}
                  >
                    <Input
                      value={c.jurisdiction}
                      disabled={locked}
                      maxLength={2}
                      placeholder="TX"
                      onChange={(e) =>
                        setCredentials((prev) =>
                          prev.map((x, j) =>
                            j === i ? { ...x, jurisdiction: e.target.value.toUpperCase() } : x,
                          ),
                        )
                      }
                    />
                  </Field>

                  <Field label="Number" required>
                    <Input
                      value={c.number}
                      disabled={locked}
                      onChange={(e) =>
                        setCredentials((prev) =>
                          prev.map((x, j) => (j === i ? { ...x, number: e.target.value } : x)),
                        )
                      }
                    />
                  </Field>

                  <Field label="Expires">
                    <Input
                      type="date"
                      value={c.expiresAt}
                      disabled={locked}
                      onChange={(e) =>
                        setCredentials((prev) =>
                          prev.map((x, j) => (j === i ? { ...x, expiresAt: e.target.value } : x)),
                        )
                      }
                    />
                  </Field>

                  <Field label="Issuing authority" className="sm:col-span-2">
                    <Input
                      value={c.issuedBy}
                      disabled={locked}
                      placeholder="e.g. Texas Real Estate Commission"
                      onChange={(e) =>
                        setCredentials((prev) =>
                          prev.map((x, j) => (j === i ? { ...x, issuedBy: e.target.value } : x)),
                        )
                      }
                    />
                  </Field>
                </div>
              </div>
            ))}
          </div>

          {!locked && (
            <div className="flex flex-wrap gap-2 mt-3.5">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setCredentials((prev) => [
                    ...prev,
                    { kind: 'LICENSE', jurisdiction: '', number: '', issuedBy: '', expiresAt: '' },
                  ])
                }
              >
                + Add a license
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={saveCredentials}
                disabled={busy || credentials.some((c) => !c.number.trim())}
              >
                {busy ? <Spinner /> : null}
                Save credentials
              </Button>
            </div>
          )}
        </Card>

        {/* ------------------------------------------------- 3. documents */}
        <Card className="p-4 sm:p-5">
          <div className="flex items-center gap-2.5 mb-1.5">
            <span
              className={`step-dot ${onboarding.missingDocuments.length === 0 ? 'step-dot-done' : 'step-dot-active'}`}
            >
              3
            </span>
            <h2 className="text-lg">License, insurance &amp; ID</h2>
          </div>
          <p className="text-[13.5px] text-[var(--color-ink-3)] mb-4 ml-9">
            Only our verification team sees these. They are never shown to customers.
          </p>

          <div className="space-y-2.5">
            {REQUIRED_DOCS.map(([kind, title, hint]) => {
              const doc = docFor(kind);
              const rejected = rejectedFor(kind);
              return (
                <div
                  key={kind}
                  className="p-3.5"
                  style={{
                    border: '1px solid var(--color-rule)',
                    borderLeft: `3px solid ${doc ? 'var(--color-go)' : 'var(--color-rule-strong)'}`,
                  }}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-[14.5px]">{title}</p>
                        {doc && (
                          <Badge
                            tone={
                              doc.reviewState === 'APPROVED'
                                ? 'badge-go'
                                : doc.reviewState === 'REJECTED'
                                  ? 'badge-stop'
                                  : 'badge-hold'
                            }
                          >
                            {titleCase(doc.reviewState)}
                          </Badge>
                        )}
                      </div>
                      <p className="text-[13px] text-[var(--color-ink-3)] mt-0.5">{hint}</p>

                      {doc && (
                        <p className="ref text-[11.5px] text-[var(--color-ink-3)] mt-1.5">
                          {doc.fileName} · {bytes(doc.sizeBytes)} · {dateTimeFull(doc.createdAt)}
                        </p>
                      )}
                      {doc?.reviewNotes && (
                        <p className="text-[13px] mt-1" style={{ color: 'var(--color-stop)' }}>
                          {doc.reviewNotes}
                        </p>
                      )}
                      {rejected && !doc && (
                        <p className="text-[13px] mt-1" style={{ color: 'var(--color-stop)' }}>
                          Rejected: {rejected.reviewNotes || 'please upload a clearer copy'}
                        </p>
                      )}
                    </div>

                    {!locked && (
                      <Button
                        variant={doc ? 'quiet' : 'outline'}
                        size="sm"
                        disabled={uploadingKind === kind}
                        onClick={() => {
                          fileRef.current.dataset.kind = kind;
                          fileRef.current.click();
                        }}
                        className="flex-none"
                      >
                        {uploadingKind === kind ? <Spinner /> : null}
                        {doc ? 'Replace' : 'Upload'}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <p className="text-[12.5px] text-[var(--color-ink-3)] mt-3.5">
            PDF or a clear photo, up to 15 MB.
          </p>
        </Card>

        {/* ---------------------------------------------------- 5. submit */}
        {!locked && (
          <Card className="p-4 sm:p-5" ticked>
            <Eyebrow className="mb-2.5">Ready?</Eyebrow>

            {onboarding.canSubmit ? (
              <>
                <p className="mb-4">
                  Everything&apos;s in. Submit and our team will verify your documents — usually
                  within one business day.
                </p>
                <Button variant="primary" onClick={submit} disabled={busy} className="w-full sm:w-auto">
                  {busy ? <Spinner /> : null}
                  Submit my application
                </Button>
              </>
            ) : (
              <>
                <p className="mb-2.5">Still to do before you can submit:</p>
                <ul className="space-y-1.5 text-[14px]">
                  {!onboarding.hasServices && <li>• Choose at least one service</li>}
                  {!onboarding.hasAreas && <li>• Choose at least one area you cover</li>}
                  {onboarding.missingDocuments.map((k) => (
                    <li key={k}>
                      • Upload your{' '}
                      {REQUIRED_DOCS.find(([kk]) => kk === k)?.[1].toLowerCase() ?? titleCase(k)}
                    </li>
                  ))}
                  {(onboarding.statesMissingLicense ?? []).map((st) => (
                    <li key={st}>• Add your {st} license</li>
                  ))}
                </ul>
                <p className="text-[13px] text-[var(--color-ink-3)] mt-3.5">
                  Remember to hit save after picking your services and areas.
                </p>
              </>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
