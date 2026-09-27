import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { dateLong, duration, money, relative, timeOnly } from '../../lib/format.js';
import {
  Alert,
  Badge,
  Button,
  Card,
  Empty,
  ErrorState,
  Eyebrow,
  Loading,
  PageHead,
  Spinner,
} from '../../components/ui.jsx';
import { getSocket, useSocketEvent } from '../../lib/socket.js';

/**
 * The live job board.
 *
 * Two things make this feel real rather than a list that happens to refresh:
 *  - a job someone else accepts disappears the instant it happens (job:taken)
 *  - a new job slides in at the top with a highlight (job:opened)
 *
 * Accepting is a race, so the losing tap must fail gracefully and informatively
 * — the card is removed and the reason is stated, rather than a dead button.
 */
export default function JobBoard() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [accepting, setAccepting] = useState(null);
  const [flash, setFlash] = useState(null);
  const [freshIds, setFreshIds] = useState(new Set());
  const [connected, setConnected] = useState(false);

  const load = useCallback(() => {
    setError(null);
    api.provider.available().then(setData).catch(setError);
  }, []);

  useEffect(load, [load]);

  // Connection state, shown honestly — a provider should know if the board has
  // stopped being live rather than trusting a stale screen.
  useEffect(() => {
    const s = getSocket();
    setConnected(s.connected);
    const on = () => setConnected(true);
    const off = () => setConnected(false);
    s.on('connect', on);
    s.on('disconnect', off);
    return () => {
      s.off('connect', on);
      s.off('disconnect', off);
    };
  }, []);

  const flashTimer = useRef(null);
  const showFlash = (tone, text) => {
    setFlash({ tone, text });
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 6000);
  };
  useEffect(() => () => clearTimeout(flashTimer.current), []);

  useSocketEvent('job:opened', (job) => {
    if (!job?.id) return;
    setFreshIds((prev) => new Set(prev).add(job.id));
    // Refetch rather than splicing the socket payload in: the board query
    // applies eligibility and clash rules the event does not carry.
    load();
    setTimeout(() => {
      setFreshIds((prev) => {
        const next = new Set(prev);
        next.delete(job.id);
        return next;
      });
    }, 12_000);
  });

  useSocketEvent('job:taken', ({ id }) => {
    setData((d) => (d ? { ...d, jobs: d.jobs.filter((j) => j.id !== id) } : d));
  });

  const accept = async (job) => {
    setAccepting(job.id);
    try {
      await api.provider.accept(job.id);
      navigate(`/provider/jobs/${job.id}?accepted=1`);
    } catch (e) {
      // Whatever the reason, this job is no longer takeable by us — drop it.
      setData((d) => (d ? { ...d, jobs: d.jobs.filter((j) => j.id !== job.id) } : d));
      showFlash(
        e.code === 'JOB_TAKEN' ? 'hold' : 'stop',
        e.code === 'JOB_TAKEN'
          ? `Another provider got ${job.reference} first — it happens, the board moves fast.`
          : e.message,
      );
    } finally {
      setAccepting(null);
    }
  };

  return (
    <div>
      <PageHead
        eyebrow="Available work"
        title="Job board"
        sub="Jobs in your areas, for the services you offer. First to accept gets it."
        actions={
          <span className="flex items-center gap-2 text-[12px]" style={{ fontFamily: 'var(--font-mono)' }}>
            <span
              className={connected ? 'pulse-dot' : ''}
              style={{ color: connected ? 'var(--color-go)' : 'var(--color-ink-3)' }}
            >
              ●
            </span>
            <span className="text-[var(--color-ink-3)] uppercase tracking-[.1em]">
              {connected ? 'Live' : 'Reconnecting'}
            </span>
            <button onClick={load} className="btn btn-quiet btn-sm ml-1">
              Refresh
            </button>
          </span>
        }
      />

      {flash && (
        <Alert tone={flash.tone} className="mb-5">
          {flash.text}
        </Alert>
      )}
      {error && <ErrorState error={error} onRetry={load} />}
      {!data && !error && <Loading label="Loading the board" />}

      {data?.note && (
        <Alert tone="info" className="mb-5">
          {data.note}
        </Alert>
      )}

      {data && data.jobs.length === 0 && !data.note && (
        <Card className="p-2">
          <Empty title="Nothing on the board right now">
            New jobs appear here the moment a customer pays — you don&apos;t need to refresh, and
            we&apos;ll text you too. Widen your service areas if you want to see more.
          </Empty>
        </Card>
      )}

      <div className="space-y-3">
        {data?.jobs.map((j, i) => {
          const isFresh = freshIds.has(j.id);
          return (
            <Card
              key={j.id}
              className="p-4 rise"
              style={{ animationDelay: `${i * 40}ms` }}
              ticked={isFresh}
            >
              <div
                className="flex flex-col sm:flex-row sm:items-start gap-4"
                style={isFresh ? { borderLeft: '3px solid var(--color-hivis)', marginLeft: -16, paddingLeft: 13 } : undefined}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1.5">
                    <span className="ref text-[12px] text-[var(--color-ink-3)]">{j.reference}</span>
                    {isFresh && <Badge tone="badge-hivis">New</Badge>}
                    {j.clashes && <Badge tone="badge-stop">Clashes with your schedule</Badge>}
                    {j.service.requiresReport && <Badge tone="badge-info">Report required</Badge>}
                  </div>

                  <h3 className="text-[18px] leading-snug">{j.service.name}</h3>

                  <p className="text-[14.5px] mt-1">
                    <strong>{dateLong(j.scheduledStart)}</strong>, {timeOnly(j.scheduledStart)}–
                    {timeOnly(j.scheduledEnd)}
                  </p>
                  <p className="text-[13.5px] text-[var(--color-ink-3)]">
                    {j.address.city} {j.address.zip} · {j.area?.name} ·{' '}
                    {duration(j.service.durationMinutes)} on site · {relative(j.scheduledStart)}
                  </p>

                  {j.customerNotes && (
                    <p
                      className="text-[13.5px] text-[var(--color-ink-2)] mt-2.5 pl-3"
                      style={{ borderLeft: '2px solid var(--color-rule-strong)' }}
                    >
                      “{j.customerNotes}”
                    </p>
                  )}
                </div>

                <div className="flex sm:flex-col items-center sm:items-end gap-3 sm:gap-2 flex-none sm:w-36">
                  <div className="text-left sm:text-right flex-1 sm:flex-none">
                    <p className="eyebrow mb-0.5">You earn</p>
                    <p
                      className="text-[24px] leading-none tnum"
                      style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}
                    >
                      {money(j.providerPayCents, data.currency)}
                    </p>
                  </div>
                  <Button
                    variant="primary"
                    className="w-auto sm:w-full flex-none"
                    onClick={() => accept(j)}
                    disabled={accepting === j.id || j.clashes}
                    title={j.clashes ? 'You already have a job at this time' : undefined}
                  >
                    {accepting === j.id ? <Spinner /> : null}
                    {j.clashes ? 'Unavailable' : 'Accept'}
                  </Button>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {data?.jobs.length > 0 && (
        <p className="text-[13px] text-[var(--color-ink-3)] mt-5">
          The customer&apos;s street address and phone number unlock as soon as you accept.
        </p>
      )}
    </div>
  );
}
