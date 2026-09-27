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
  Spinner,
  Textarea,
} from '../../components/ui.jsx';

const REQUIRED_DOCS = [
  ['IDENTITY', 'Photo ID', 'Driver licence or passport.'],
  ['LICENCE', 'Trade licence', 'Your QBCC / trade licence or equivalent registration.'],
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

  const [profile, setProfile] = useState({ businessName: '', abnOrLicenceNo: '', bio: '' });
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
          abnOrLicenceNo: me.profile.abnOrLicenceNo || '',
          bio: me.profile.bio || '',
        });
        setServiceIds(me.profile.services.map((s) => s.id));
        setAreaIds(me.profile.areas.map((a) => a.id));
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
            <Field label="ABN or licence number" hint="Shown to our team during verification.">
              <Input
                value={profile.abnOrLicenceNo}
                onChange={(e) => setProfile({ ...profile, abnOrLicenceNo: e.target.value })}
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
                    {a.postcode} · {a.city}, {a.region}
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

        {/* ------------------------------------------------- 3. documents */}
        <Card className="p-4 sm:p-5">
          <div className="flex items-center gap-2.5 mb-1.5">
            <span
              className={`step-dot ${onboarding.missingDocuments.length === 0 ? 'step-dot-done' : 'step-dot-active'}`}
            >
              3
            </span>
            <h2 className="text-lg">Licence, insurance &amp; ID</h2>
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

        {/* ---------------------------------------------------- 4. submit */}
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
