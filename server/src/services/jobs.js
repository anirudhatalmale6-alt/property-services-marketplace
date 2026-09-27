/**
 * Job lifecycle: references, the legal status graph, and transition logging.
 *
 * Every status change goes through `transitionJob`, which refuses illegal moves
 * and appends a JobEvent. That is what makes the customer's tracker and the
 * admin's audit trail the same data instead of two guesses.
 */
import crypto from 'node:crypto';
import { prisma } from '../db.js';
import { conflict, notFound } from '../lib/http.js';

/** Which statuses may follow which. Anything absent here is rejected. */
const TRANSITIONS = {
  PENDING_PAYMENT: ['OPEN', 'CANCELLED'],
  OPEN: ['ASSIGNED', 'CANCELLED', 'REFUNDED'],
  ASSIGNED: ['EN_ROUTE', 'IN_PROGRESS', 'OPEN', 'CANCELLED'], // back to OPEN if the provider drops it
  EN_ROUTE: ['IN_PROGRESS', 'OPEN', 'CANCELLED'],
  IN_PROGRESS: ['AWAITING_REPORT', 'COMPLETED', 'CANCELLED'],
  AWAITING_REPORT: ['COMPLETED', 'CANCELLED'],
  COMPLETED: ['REFUNDED'],
  CANCELLED: ['REFUNDED'],
  REFUNDED: [],
};

export const canTransition = (from, to) => (TRANSITIONS[from] || []).includes(to);
export const nextStatuses = (from) => TRANSITIONS[from] || [];

/** Statuses a customer still considers "live". */
export const ACTIVE_STATUSES = [
  'PENDING_PAYMENT',
  'OPEN',
  'ASSIGNED',
  'EN_ROUTE',
  'IN_PROGRESS',
  'AWAITING_REPORT',
];

/**
 * Human-quotable reference. Excludes I/O/0/1 so a customer reading it down the
 * phone cannot produce an ambiguous pair.
 */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function generateReference() {
  const bytes = crypto.randomBytes(6);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return `PS-${out}`;
}

/** Reserve a unique reference, retrying on the (very unlikely) collision. */
export async function uniqueReference(attempts = 5) {
  for (let i = 0; i < attempts; i += 1) {
    const ref = generateReference();
    const clash = await prisma.job.findUnique({ where: { reference: ref }, select: { id: true } });
    if (!clash) return ref;
  }
  throw new Error('Could not allocate a unique job reference');
}

/**
 * Move a job to a new status, recording who did it and why.
 *
 * @param {object} opts
 * @param {string} opts.jobId
 * @param {string} opts.to target JobStatus
 * @param {object} [opts.actor] the acting user ({id, role})
 * @param {string} [opts.note]
 * @param {object} [opts.data] extra Job fields to set in the same write
 * @param {object} [opts.tx] run inside an existing transaction
 */
export async function transitionJob({ jobId, to, actor, note, data = {}, tx }) {
  const client = tx || prisma;

  const job = await client.job.findUnique({ where: { id: jobId } });
  if (!job) throw notFound('Job not found');
  if (job.status === to) return job; // idempotent: nothing to log

  if (!canTransition(job.status, to)) {
    throw conflict(
      `A job that is ${job.status.toLowerCase().replace(/_/g, ' ')} cannot become ${to
        .toLowerCase()
        .replace(/_/g, ' ')}`,
      'ILLEGAL_TRANSITION',
    );
  }

  const stamps = {};
  if (to === 'ASSIGNED') stamps.assignedAt = new Date();
  if (to === 'IN_PROGRESS' && !job.startedAt) stamps.startedAt = new Date();
  if (to === 'COMPLETED') stamps.completedAt = new Date();
  if (to === 'CANCELLED') stamps.cancelledAt = new Date();

  const updated = await client.job.update({
    where: { id: jobId },
    data: { status: to, ...stamps, ...data },
  });

  await client.jobEvent.create({
    data: {
      jobId,
      fromStatus: job.status,
      toStatus: to,
      actorId: actor?.id ?? null,
      actorRole: actor?.role ?? null,
      note: note ?? null,
    },
  });

  return updated;
}

/** Record an exception for the admin triage queue. */
export async function raiseException({ jobId, kind, detail, tx }) {
  const client = tx || prisma;
  return client.jobException.create({ data: { jobId: jobId ?? null, kind, detail: String(detail).slice(0, 500) } });
}

/** The shape the customer-facing tracker and provider portal both render. */
export const jobInclude = {
  service: { select: { id: true, name: true, slug: true, durationMinutes: true, requiresReport: true } },
  address: true,
  area: { select: { id: true, name: true, city: true, region: true, postcode: true } },
  payment: { select: { id: true, status: true, amountCents: true, currency: true, paidAt: true, refundedCents: true } },
  payout: { select: { id: true, status: true, amountCents: true, paidAt: true } },
  documents: {
    select: { id: true, kind: true, fileName: true, mimeType: true, sizeBytes: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  },
  events: { orderBy: { createdAt: 'asc' } },
  provider: {
    select: {
      id: true,
      businessName: true,
      user: { select: { fullName: true, phone: true } },
    },
  },
  customer: { select: { id: true, fullName: true, email: true, phone: true } },
};

/**
 * Friendly labels for the customer tracker. The enum is the source of truth;
 * this is presentation only.
 */
export const STATUS_LABELS = {
  PENDING_PAYMENT: 'Awaiting payment',
  OPEN: 'Finding a provider',
  ASSIGNED: 'Provider assigned',
  EN_ROUTE: 'Provider on the way',
  IN_PROGRESS: 'Work in progress',
  AWAITING_REPORT: 'Awaiting report',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  REFUNDED: 'Refunded',
};
