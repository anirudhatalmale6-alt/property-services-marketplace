/**
 * Admin dashboard API: customers, providers, jobs, payments, assignments,
 * documents, exceptions.
 */
import express from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { asyncHandler, badRequest, conflict, notFound, parse } from '../lib/http.js';
import { requireAuth, requireRole } from '../lib/auth.js';
import { STATUS_LABELS, jobInclude, transitionJob } from '../services/jobs.js';
import { assignJobToProvider, releaseJob } from '../services/assignment.js';
import { refundPayment, sendPayout } from '../services/payments.js';
import { notifyUser } from '../services/notify.js';
import { emitJobUpdated, emitProviderUpdated } from '../realtime.js';

export const adminRouter = express.Router();
adminRouter.use(requireAuth, requireRole('ADMIN'));

const pageSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().max(120).optional(),
});

const paginate = ({ page, perPage }) => ({ skip: (page - 1) * perPage, take: perPage });

/**
 * Enum values for the list filters.
 *
 * These MUST be validated here rather than passed through to Prisma. An
 * unrecognised value reaches the query builder, throws, and the 500 handler
 * echoes the generated SQL shape back to the caller — a 400 with a clear
 * message is both correct and not a disclosure.
 */
const JOB_STATUSES = [
  'PENDING_PAYMENT',
  'OPEN',
  'ASSIGNED',
  'EN_ROUTE',
  'IN_PROGRESS',
  'AWAITING_REPORT',
  'COMPLETED',
  'CANCELLED',
  'REFUNDED',
];
const PROVIDER_STATUSES = ['DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED'];
const PAYMENT_STATUSES = ['REQUIRES_PAYMENT', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'REFUNDED'];
const PAYOUT_STATUSES = ['PENDING', 'PROCESSING', 'PAID', 'FAILED'];
const EXCEPTION_STATUSES = ['OPEN', 'RESOLVED', 'DISMISSED'];
const NOTIFICATION_STATUSES = ['QUEUED', 'SENT', 'FAILED'];

/** An optional enum filter that rejects anything not in the list. */
const statusFilter = (values) =>
  z
    .enum(values)
    .optional()
    .or(z.literal('').transform(() => undefined));

// ------------------------------------------------------------- overview

adminRouter.get(
  '/overview',
  asyncHandler(async (req, res) => {
    const since = new Date(Date.now() - 30 * 86_400_000);

    const [
      jobsByStatus,
      openExceptions,
      providersPending,
      revenue,
      payoutsPending,
      docsPending,
      customers,
      failedNotifications,
    ] = await Promise.all([
      prisma.job.groupBy({ by: ['status'], _count: true }),
      prisma.jobException.count({ where: { status: 'OPEN' } }),
      prisma.providerProfile.count({ where: { status: 'PENDING' } }),
      prisma.payment.aggregate({
        where: { status: 'SUCCEEDED', paidAt: { gte: since } },
        _sum: { amountCents: true },
        _count: true,
      }),
      prisma.payout.aggregate({
        where: { status: { in: ['PENDING', 'PROCESSING'] } },
        _sum: { amountCents: true },
        _count: true,
      }),
      prisma.document.count({ where: { reviewState: 'PENDING', providerId: { not: null } } }),
      prisma.user.count({ where: { role: 'CUSTOMER' } }),
      prisma.notification.count({ where: { status: 'FAILED' } }),
    ]);

    res.json({
      currency: env.currency,
      jobsByStatus: Object.fromEntries(
        jobsByStatus.map((r) => [r.status, typeof r._count === 'number' ? r._count : r._count._all]),
      ),
      counters: {
        openExceptions,
        providersPending,
        docsPending,
        customers,
        failedNotifications,
        revenue30dCents: revenue._sum.amountCents ?? 0,
        paidJobs30d: revenue._count,
        payoutsPendingCents: payoutsPending._sum.amountCents ?? 0,
        payoutsPendingCount: payoutsPending._count,
      },
    });
  }),
);

// ------------------------------------------------------------- providers

adminRouter.get(
  '/providers',
  asyncHandler(async (req, res) => {
    const { page, perPage, q, status } = parse(
      pageSchema.extend({ status: statusFilter(PROVIDER_STATUSES) }),
      req.query,
    );

    const where = {
      ...(status ? { status } : {}),
      ...(q
        ? {
            OR: [
              { businessName: { contains: q, mode: 'insensitive' } },
              { user: { fullName: { contains: q, mode: 'insensitive' } } },
              { user: { email: { contains: q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const [total, providers] = await Promise.all([
      prisma.providerProfile.count({ where }),
      prisma.providerProfile.findMany({
        where,
        ...paginate({ page, perPage }),
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        select: {
          id: true,
          businessName: true,
          status: true,
          submittedAt: true,
          reviewedAt: true,
          createdAt: true,
          user: { select: { id: true, fullName: true, email: true, phone: true, isActive: true } },
          _count: { select: { jobs: true, documents: true } },
        },
      }),
    ]);

    res.json({ total, page, perPage, providers });
  }),
);

adminRouter.get(
  '/providers/:id',
  asyncHandler(async (req, res) => {
    const provider = await prisma.providerProfile.findUnique({
      where: { id: req.params.id },
      include: {
        user: { select: { id: true, fullName: true, email: true, phone: true, isActive: true, createdAt: true } },
        services: { include: { service: { select: { id: true, name: true } } } },
        areas: { include: { area: { select: { id: true, name: true, city: true, region: true } } } },
        documents: { orderBy: { createdAt: 'desc' } },
        jobs: {
          orderBy: { scheduledStart: 'desc' },
          take: 20,
          select: { id: true, reference: true, status: true, scheduledStart: true, providerPayCents: true },
        },
        payouts: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });
    if (!provider) throw notFound('Provider not found');

    res.json({
      currency: env.currency,
      provider: {
        ...provider,
        services: provider.services.map((s) => s.service),
        areas: provider.areas.map((a) => a.area),
        // Never leak the storage key to the browser; downloads go through the
        // authenticated document route by id.
        documents: provider.documents.map(({ storageKey, ...d }) => d),
      },
    });
  }),
);

/** Approve / reject / suspend. The single gate that lets a provider work. */
adminRouter.post(
  '/providers/:id/review',
  asyncHandler(async (req, res) => {
    const { decision, notes } = parse(
      z.object({
        decision: z.enum(['APPROVED', 'REJECTED', 'SUSPENDED', 'PENDING']),
        notes: z.string().trim().max(1000).optional(),
      }),
      req.body,
    );

    const provider = await prisma.providerProfile.findUnique({
      where: { id: req.params.id },
      include: { user: true, services: true, areas: true, documents: true },
    });
    if (!provider) throw notFound('Provider not found');

    if (decision === 'APPROVED') {
      // Approving someone with no coverage creates a provider who can never be
      // matched — refuse rather than produce a silently useless account.
      if (provider.services.length === 0 || provider.areas.length === 0) {
        throw badRequest(
          'This provider has no services or no service areas set, so they could never be matched to a job',
        );
      }
      const kinds = new Set(provider.documents.map((d) => d.kind));
      const missing = ['IDENTITY', 'LICENCE', 'INSURANCE'].filter((k) => !kinds.has(k));
      if (missing.length) {
        throw badRequest(`Cannot approve — still missing: ${missing.join(', ').toLowerCase()}`);
      }
    }

    const updated = await prisma.providerProfile.update({
      where: { id: provider.id },
      data: { status: decision, reviewedAt: new Date(), reviewNotes: notes ?? null },
    });

    if (decision === 'APPROVED') {
      await notifyUser('provider_approved', provider.user, { providerName: provider.businessName });
    } else if (decision === 'REJECTED') {
      await notifyUser('provider_rejected', provider.user, {
        providerName: provider.businessName,
        reason: notes,
      });
    }

    emitProviderUpdated(updated);
    res.json({ provider: { id: updated.id, status: updated.status, reviewedAt: updated.reviewedAt } });
  }),
);

adminRouter.post(
  '/documents/:id/review',
  asyncHandler(async (req, res) => {
    const { decision, notes } = parse(
      z.object({
        decision: z.enum(['APPROVED', 'REJECTED', 'PENDING']),
        notes: z.string().trim().max(500).optional(),
      }),
      req.body,
    );

    const doc = await prisma.document.findUnique({ where: { id: req.params.id } });
    if (!doc) throw notFound('Document not found');

    const updated = await prisma.document.update({
      where: { id: doc.id },
      data: {
        reviewState: decision,
        reviewNotes: notes ?? null,
        reviewedById: req.user.id,
        reviewedAt: new Date(),
      },
      select: { id: true, reviewState: true, reviewNotes: true, reviewedAt: true },
    });

    res.json({ document: updated });
  }),
);

// ------------------------------------------------------------- customers

adminRouter.get(
  '/customers',
  asyncHandler(async (req, res) => {
    const { page, perPage, q } = parse(pageSchema, req.query);

    const where = {
      role: 'CUSTOMER',
      ...(q
        ? {
            OR: [
              { fullName: { contains: q, mode: 'insensitive' } },
              { email: { contains: q, mode: 'insensitive' } },
              { phone: { contains: q } },
            ],
          }
        : {}),
    };

    const [total, customers] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        ...paginate({ page, perPage }),
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          fullName: true,
          email: true,
          phone: true,
          isActive: true,
          createdAt: true,
          lastLoginAt: true,
          _count: { select: { jobs: true } },
        },
      }),
    ]);

    res.json({ total, page, perPage, customers });
  }),
);

adminRouter.post(
  '/users/:id/active',
  asyncHandler(async (req, res) => {
    const { isActive } = parse(z.object({ isActive: z.boolean() }), req.body);

    if (req.params.id === req.user.id && !isActive) {
      throw badRequest('You cannot disable your own account');
    }

    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { isActive },
      select: { id: true, email: true, isActive: true },
    });

    // Disabling must end their sessions, or the access token keeps working
    // until it expires.
    if (!isActive) {
      await prisma.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    res.json({ user });
  }),
);

// ------------------------------------------------------------------ jobs

adminRouter.get(
  '/jobs',
  asyncHandler(async (req, res) => {
    const { page, perPage, q, status } = parse(
      pageSchema.extend({ status: statusFilter(JOB_STATUSES) }),
      req.query,
    );

    const where = {
      ...(status ? { status } : {}),
      ...(q
        ? {
            OR: [
              { reference: { contains: q.toUpperCase() } },
              { customer: { fullName: { contains: q, mode: 'insensitive' } } },
              { customer: { email: { contains: q, mode: 'insensitive' } } },
              { address: { postcode: { contains: q } } },
            ],
          }
        : {}),
    };

    const [total, jobs] = await Promise.all([
      prisma.job.count({ where }),
      prisma.job.findMany({
        where,
        ...paginate({ page, perPage }),
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          reference: true,
          status: true,
          scheduledStart: true,
          priceCents: true,
          providerPayCents: true,
          createdAt: true,
          service: { select: { name: true } },
          customer: { select: { id: true, fullName: true, email: true } },
          provider: { select: { id: true, businessName: true } },
          address: { select: { city: true, region: true, postcode: true } },
          payment: { select: { status: true, amountCents: true } },
          payout: { select: { status: true, amountCents: true } },
          _count: { select: { exceptions: true } },
        },
      }),
    ]);

    res.json({
      currency: env.currency,
      total,
      page,
      perPage,
      jobs: jobs.map((j) => ({ ...j, statusLabel: STATUS_LABELS[j.status] })),
    });
  }),
);

adminRouter.get(
  '/jobs/:id',
  asyncHandler(async (req, res) => {
    const job = await prisma.job.findUnique({
      where: { id: req.params.id },
      include: { ...jobInclude, exceptions: { orderBy: { createdAt: 'desc' } } },
    });
    if (!job) throw notFound('Job not found');

    res.json({
      currency: env.currency,
      job: { ...job, statusLabel: STATUS_LABELS[job.status] },
    });
  }),
);

/** Candidate providers for a manual assignment, with clashes flagged. */
adminRouter.get(
  '/jobs/:id/candidates',
  asyncHandler(async (req, res) => {
    const job = await prisma.job.findUnique({
      where: { id: req.params.id },
      select: { id: true, serviceId: true, serviceAreaId: true, scheduledStart: true, scheduledEnd: true },
    });
    if (!job) throw notFound('Job not found');

    const providers = await prisma.providerProfile.findMany({
      where: {
        status: 'APPROVED',
        services: { some: { serviceId: job.serviceId } },
        ...(job.serviceAreaId ? { areas: { some: { serviceAreaId: job.serviceAreaId } } } : {}),
      },
      select: {
        id: true,
        businessName: true,
        user: { select: { fullName: true, phone: true, email: true } },
        jobs: {
          where: {
            status: { in: ['ASSIGNED', 'EN_ROUTE', 'IN_PROGRESS', 'AWAITING_REPORT'] },
            scheduledStart: { lt: job.scheduledEnd },
            scheduledEnd: { gt: job.scheduledStart },
          },
          select: { id: true, reference: true },
        },
      },
    });

    res.json({
      candidates: providers.map((p) => ({
        id: p.id,
        businessName: p.businessName,
        contact: p.user,
        available: p.jobs.length === 0,
        clashesWith: p.jobs.map((j) => j.reference),
      })),
    });
  }),
);

adminRouter.post(
  '/jobs/:id/assign',
  asyncHandler(async (req, res) => {
    const { providerId, note } = parse(
      z.object({ providerId: z.string().uuid(), note: z.string().trim().max(500).optional() }),
      req.body,
    );

    const job = await assignJobToProvider(req.params.id, providerId, req.user, note);

    await notifyUser('provider_assigned', job.customer, {
      job,
      service: job.service,
      providerName: job.provider.businessName,
    });

    const full = await prisma.job.findUnique({ where: { id: job.id }, include: jobInclude });
    emitJobUpdated(full);

    res.json({ job: full, statusLabel: STATUS_LABELS[full.status] });
  }),
);

adminRouter.post(
  '/jobs/:id/unassign',
  asyncHandler(async (req, res) => {
    const { reason } = parse(
      z.object({ reason: z.string().trim().max(500).optional() }),
      req.body ?? {},
    );
    await releaseJob(req.params.id, req.user, { reason: reason || 'Unassigned by admin' });

    const full = await prisma.job.findUnique({ where: { id: req.params.id }, include: jobInclude });
    emitJobUpdated(full);
    res.json({ job: full, statusLabel: STATUS_LABELS[full.status] });
  }),
);

adminRouter.post(
  '/jobs/:id/status',
  asyncHandler(async (req, res) => {
    const { to, note } = parse(
      z.object({
        to: z.enum([
          'OPEN',
          'ASSIGNED',
          'EN_ROUTE',
          'IN_PROGRESS',
          'AWAITING_REPORT',
          'COMPLETED',
          'CANCELLED',
        ]),
        note: z.string().trim().max(500).optional(),
      }),
      req.body,
    );

    await transitionJob({ jobId: req.params.id, to, actor: req.user, note });
    const full = await prisma.job.findUnique({ where: { id: req.params.id }, include: jobInclude });
    emitJobUpdated(full);

    res.json({ job: full, statusLabel: STATUS_LABELS[full.status] });
  }),
);

// -------------------------------------------------------------- payments

adminRouter.get(
  '/payments',
  asyncHandler(async (req, res) => {
    const { page, perPage, status } = parse(
      pageSchema.extend({ status: statusFilter(PAYMENT_STATUSES) }),
      req.query,
    );

    const where = status ? { status } : {};
    const [total, payments, totals] = await Promise.all([
      prisma.payment.count({ where }),
      prisma.payment.findMany({
        where,
        ...paginate({ page, perPage }),
        orderBy: { createdAt: 'desc' },
        include: {
          job: {
            select: {
              id: true,
              reference: true,
              status: true,
              service: { select: { name: true } },
              customer: { select: { fullName: true, email: true } },
            },
          },
        },
      }),
      prisma.payment.aggregate({ where: { status: 'SUCCEEDED' }, _sum: { amountCents: true, refundedCents: true } }),
    ]);

    res.json({
      currency: env.currency,
      total,
      page,
      perPage,
      payments,
      totals: {
        collectedCents: totals._sum.amountCents ?? 0,
        refundedCents: totals._sum.refundedCents ?? 0,
      },
    });
  }),
);

adminRouter.post(
  '/payments/:id/refund',
  asyncHandler(async (req, res) => {
    const { amountCents, note } = parse(
      z.object({
        amountCents: z.number().int().positive().optional(),
        note: z.string().trim().max(500).optional(),
      }),
      req.body ?? {},
    );

    const payment = await prisma.payment.findUnique({
      where: { id: req.params.id },
      include: { job: { include: { customer: true } } },
    });
    if (!payment) throw notFound('Payment not found');
    if (payment.status !== 'SUCCEEDED' && payment.status !== 'REFUNDED') {
      throw conflict('Only a successful payment can be refunded', 'NOT_REFUNDABLE');
    }

    const remaining = payment.amountCents - payment.refundedCents;
    if (remaining <= 0) throw conflict('This payment is already fully refunded', 'ALREADY_REFUNDED');
    if (amountCents && amountCents > remaining) {
      throw badRequest(`Only ${(remaining / 100).toFixed(2)} remains to refund`);
    }

    await refundPayment(payment, amountCents);

    // A refund closes the job out too, unless it is already terminal.
    if (!['REFUNDED', 'CANCELLED'].includes(payment.job.status)) {
      await transitionJob({
        jobId: payment.jobId,
        to: 'REFUNDED',
        actor: req.user,
        note: note || 'Refunded by admin',
      }).catch(() => {}); // an illegal transition here must not fail the refund
    }

    await prisma.jobException.updateMany({
      where: { jobId: payment.jobId, kind: 'REFUND_REQUESTED', status: 'OPEN' },
      data: { status: 'RESOLVED', resolvedAt: new Date(), resolvedById: req.user.id, resolution: 'Refunded' },
    });

    const fresh = await prisma.payment.findUnique({ where: { id: payment.id } });
    res.json({ payment: fresh });
  }),
);

// --------------------------------------------------------------- payouts

adminRouter.get(
  '/payouts',
  asyncHandler(async (req, res) => {
    const { page, perPage, status } = parse(
      pageSchema.extend({ status: statusFilter(PAYOUT_STATUSES) }),
      req.query,
    );
    const where = status ? { status } : {};

    const [total, payouts] = await Promise.all([
      prisma.payout.count({ where }),
      prisma.payout.findMany({
        where,
        ...paginate({ page, perPage }),
        orderBy: { createdAt: 'desc' },
        include: {
          provider: { select: { id: true, businessName: true, payoutRef: true, user: { select: { email: true } } } },
          job: { select: { id: true, reference: true, completedAt: true, service: { select: { name: true } } } },
        },
      }),
    ]);

    res.json({ currency: env.currency, total, page, perPage, payouts });
  }),
);

adminRouter.post(
  '/payouts/:id/send',
  asyncHandler(async (req, res) => {
    const payout = await prisma.payout.findUnique({
      where: { id: req.params.id },
      include: { provider: { include: { user: true } }, job: true },
    });
    if (!payout) throw notFound('Payout not found');
    if (payout.status === 'PAID') throw conflict('This payout has already been sent', 'ALREADY_PAID');
    if (payout.job.status !== 'COMPLETED') {
      throw conflict('Only a completed job can be paid out', 'JOB_NOT_COMPLETE');
    }

    const sent = await sendPayout(payout, payout.provider);
    await notifyUser('payout_sent', payout.provider.user, { payout: sent, job: payout.job });

    res.json({ payout: sent });
  }),
);

// ------------------------------------------------------------ exceptions

adminRouter.get(
  '/exceptions',
  asyncHandler(async (req, res) => {
    const { page, perPage, status } = parse(
      pageSchema.extend({
        status: z.enum([...EXCEPTION_STATUSES, 'ALL']).default('OPEN'),
      }),
      req.query,
    );
    const where = status === 'ALL' ? {} : { status };

    const [total, exceptions] = await Promise.all([
      prisma.jobException.count({ where }),
      prisma.jobException.findMany({
        where,
        ...paginate({ page, perPage }),
        orderBy: { createdAt: 'desc' },
        include: {
          job: {
            select: {
              id: true,
              reference: true,
              status: true,
              scheduledStart: true,
              service: { select: { name: true } },
              customer: { select: { fullName: true, email: true, phone: true } },
            },
          },
          resolvedBy: { select: { fullName: true } },
        },
      }),
    ]);

    res.json({ total, page, perPage, exceptions });
  }),
);

adminRouter.post(
  '/exceptions/:id/resolve',
  asyncHandler(async (req, res) => {
    const { resolution, dismiss } = parse(
      z.object({
        resolution: z.string().trim().min(2, 'Say what was done').max(500),
        dismiss: z.boolean().default(false),
      }),
      req.body,
    );

    const exception = await prisma.jobException.findUnique({ where: { id: req.params.id } });
    if (!exception) throw notFound('Exception not found');

    const updated = await prisma.jobException.update({
      where: { id: exception.id },
      data: {
        status: dismiss ? 'DISMISSED' : 'RESOLVED',
        resolution,
        resolvedById: req.user.id,
        resolvedAt: new Date(),
      },
    });

    res.json({ exception: updated });
  }),
);

// --------------------------------------------------------- notifications

adminRouter.get(
  '/notifications',
  asyncHandler(async (req, res) => {
    const { page, perPage, status } = parse(
      pageSchema.extend({ status: statusFilter(NOTIFICATION_STATUSES) }),
      req.query,
    );
    const where = status ? { status } : {};

    const [total, notifications] = await Promise.all([
      prisma.notification.count({ where }),
      prisma.notification.findMany({
        where,
        ...paginate({ page, perPage }),
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { fullName: true, role: true } } },
      }),
    ]);

    res.json({ total, page, perPage, notifications });
  }),
);

// -------------------------------------------------- catalogue management

adminRouter.get(
  '/services',
  asyncHandler(async (req, res) => {
    const services = await prisma.service.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { category: { select: { id: true, name: true } }, _count: { select: { jobs: true, providers: true } } },
    });
    const categories = await prisma.serviceCategory.findMany({ orderBy: { sortOrder: 'asc' } });
    res.json({ currency: env.currency, services, categories });
  }),
);

const serviceWriteSchema = z.object({
  categoryId: z.string().uuid(),
  name: z.string().trim().min(2).max(160),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(160)
    .regex(/^[a-z0-9-]+$/, 'Lowercase letters, numbers and hyphens only'),
  shortDescription: z.string().trim().min(2).max(300),
  description: z.string().trim().min(2).max(4000),
  basePriceCents: z.number().int().min(0),
  providerPayCents: z.number().int().min(0),
  durationMinutes: z.number().int().min(15).max(600),
  requiresReport: z.boolean().default(true),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});

adminRouter.post(
  '/services',
  asyncHandler(async (req, res) => {
    const body = parse(serviceWriteSchema, req.body);
    if (body.providerPayCents > body.basePriceCents) {
      throw badRequest('The provider payment cannot exceed the customer price');
    }
    const service = await prisma.service.create({ data: body });
    res.status(201).json({ service });
  }),
);

adminRouter.patch(
  '/services/:id',
  asyncHandler(async (req, res) => {
    const body = parse(serviceWriteSchema.partial(), req.body);

    const current = await prisma.service.findUnique({ where: { id: req.params.id } });
    if (!current) throw notFound('Service not found');

    const price = body.basePriceCents ?? current.basePriceCents;
    const pay = body.providerPayCents ?? current.providerPayCents;
    if (pay > price) throw badRequest('The provider payment cannot exceed the customer price');

    const service = await prisma.service.update({ where: { id: req.params.id }, data: body });
    res.json({ service });
  }),
);

/**
 * Service areas — this is the nationwide expansion control. Adding a row here
 * is what makes a new market bookable.
 */
adminRouter.get(
  '/areas',
  asyncHandler(async (req, res) => {
    const areas = await prisma.serviceArea.findMany({
      orderBy: [{ region: 'asc' }, { city: 'asc' }],
      include: { _count: { select: { providers: true, jobs: true } } },
    });
    res.json({ areas });
  }),
);

adminRouter.post(
  '/areas',
  asyncHandler(async (req, res) => {
    const body = parse(
      z.object({
        name: z.string().trim().min(2).max(120),
        postcode: z.string().trim().min(3).max(12),
        city: z.string().trim().min(2).max(120),
        region: z.string().trim().min(2).max(120),
        country: z.string().trim().length(2).default('AU'),
        isActive: z.boolean().default(true),
      }),
      req.body,
    );

    const clash = await prisma.serviceArea.findFirst({
      where: { postcode: body.postcode, country: body.country },
    });
    if (clash) throw conflict(`Postcode ${body.postcode} is already a service area`, 'AREA_EXISTS');

    const area = await prisma.serviceArea.create({ data: body });
    res.status(201).json({ area });
  }),
);

adminRouter.patch(
  '/areas/:id',
  asyncHandler(async (req, res) => {
    const body = parse(
      z.object({
        name: z.string().trim().min(2).max(120).optional(),
        city: z.string().trim().min(2).max(120).optional(),
        region: z.string().trim().min(2).max(120).optional(),
        isActive: z.boolean().optional(),
      }),
      req.body,
    );
    const area = await prisma.serviceArea.update({ where: { id: req.params.id }, data: body });
    res.json({ area });
  }),
);
