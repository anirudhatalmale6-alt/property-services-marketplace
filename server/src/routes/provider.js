/**
 * Provider portal: onboarding, the job board, doing the work, getting paid.
 *
 * Every route past onboarding is behind `requireApprovedProvider`, so an
 * unverified account can submit documents and nothing else.
 */
import express from 'express';
import multer from 'multer';
import { z } from 'zod';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { asyncHandler, badRequest, conflict, forbidden, notFound, parse } from '../lib/http.js';
import { requireApprovedProvider, requireAuth, requireRole } from '../lib/auth.js';
import { STATUS_LABELS, jobInclude, raiseException, transitionJob } from '../services/jobs.js';
import { claimJob, releaseJob } from '../services/assignment.js';
import { isAllowedMime, allowedMimeList, putObject } from '../services/storage.js';
import { notifyUser } from '../services/notify.js';
import { emitJobTaken, emitJobReleased, emitJobUpdated } from '../realtime.js';

export const providerRouter = express.Router();
providerRouter.use(requireAuth, requireRole('PROVIDER'));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.maxUploadMb * 1024 * 1024, files: 6 },
});

const myProfile = async (userId) => {
  const profile = await prisma.providerProfile.findUnique({
    where: { userId },
    include: {
      services: { include: { service: { select: { id: true, name: true, slug: true } } } },
      areas: { include: { area: { select: { id: true, name: true, city: true, state: true, zip: true } } } },
      credentials: { orderBy: [{ kind: 'asc' }, { jurisdiction: 'asc' }] },
      documents: {
        select: {
          id: true,
          kind: true,
          fileName: true,
          mimeType: true,
          sizeBytes: true,
          reviewState: true,
          reviewNotes: true,
          expiresAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      },
    },
  });
  if (!profile) throw notFound('Provider profile not found');
  return profile;
};

// ------------------------------------------------------------ onboarding

providerRouter.get(
  '/me',
  asyncHandler(async (req, res) => {
    const profile = await myProfile(req.user.id);

    // Tell them exactly what is still missing, rather than a bare "pending".
    const have = new Set(
      profile.documents.filter((d) => d.reviewState !== 'REJECTED').map((d) => d.kind),
    );
    const missing = ['IDENTITY', 'LICENSE', 'INSURANCE'].filter((k) => !have.has(k));

    // SOP §13: eligibility is per jurisdiction. Serving a state you hold no
    // licence for is the gap that matters, so name it explicitly.
    const licensedStates = new Set(
      profile.credentials
        .filter((c) => c.kind === 'LICENSE' && c.reviewState !== 'REJECTED' && c.jurisdiction)
        .map((c) => c.jurisdiction),
    );
    const servedStates = [...new Set(profile.areas.map((a) => a.area.state))];
    const statesMissingLicense = servedStates.filter((st) => !licensedStates.has(st));

    res.json({
      profile: {
        id: profile.id,
        businessName: profile.businessName,
        legalName: profile.legalName,
        bio: profile.bio,
        credentials: profile.credentials,
        status: profile.status,
        submittedAt: profile.submittedAt,
        reviewedAt: profile.reviewedAt,
        reviewNotes: profile.reviewNotes,
        services: profile.services.map((s) => s.service),
        areas: profile.areas.map((a) => a.area),
        documents: profile.documents,
      },
      onboarding: {
        missingDocuments: missing,
        hasServices: profile.services.length > 0,
        hasAreas: profile.areas.length > 0,
        statesServed: servedStates,
        statesMissingLicense,
        canSubmit:
          missing.length === 0 &&
          profile.services.length > 0 &&
          profile.areas.length > 0 &&
          statesMissingLicense.length === 0,
      },
    });
  }),
);

providerRouter.patch(
  '/me',
  asyncHandler(async (req, res) => {
    const body = parse(
      z.object({
        businessName: z.string().trim().min(2).max(160).optional(),
        legalName: z.string().trim().max(160).optional(),
        bio: z.string().trim().max(1000).optional(),
      }),
      req.body,
    );

    const profile = await prisma.providerProfile.update({
      where: { userId: req.user.id },
      data: body,
    });
    res.json({ profile: { id: profile.id, status: profile.status, ...body } });
  }),
);

/** Which services this provider offers, and which markets they cover. */
providerRouter.put(
  '/me/coverage',
  asyncHandler(async (req, res) => {
    const { serviceIds, areaIds } = parse(
      z.object({
        serviceIds: z.array(z.string().uuid()).min(1, 'Choose at least one service'),
        areaIds: z.array(z.string().uuid()).min(1, 'Choose at least one area you cover'),
      }),
      req.body,
    );

    const profile = await prisma.providerProfile.findUnique({ where: { userId: req.user.id } });
    if (!profile) throw notFound('Provider profile not found');

    // Verify every id exists and is live, so a bad payload can't create
    // coverage for a retired service.
    const [services, areas] = await Promise.all([
      prisma.service.findMany({ where: { id: { in: serviceIds }, isActive: true }, select: { id: true } }),
      prisma.serviceArea.findMany({ where: { id: { in: areaIds }, isActive: true }, select: { id: true } }),
    ]);
    if (services.length !== serviceIds.length) throw badRequest('One of those services is not available');
    if (areas.length !== areaIds.length) throw badRequest('One of those areas is not available');

    await prisma.$transaction([
      prisma.providerService.deleteMany({ where: { providerId: profile.id } }),
      prisma.providerServiceArea.deleteMany({ where: { providerId: profile.id } }),
      prisma.providerService.createMany({
        data: serviceIds.map((serviceId) => ({ providerId: profile.id, serviceId })),
      }),
      prisma.providerServiceArea.createMany({
        data: areaIds.map((serviceAreaId) => ({ providerId: profile.id, serviceAreaId })),
      }),
    ]);

    res.json({ ok: true, serviceCount: serviceIds.length, areaCount: areaIds.length });
  }),
);

providerRouter.post(
  '/me/documents',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const { kind, expiresAt } = parse(
      z.object({
        kind: z.enum(['IDENTITY', 'LICENSE', 'INSURANCE', 'OTHER']),
        expiresAt: z.string().datetime().optional(),
      }),
      req.body,
    );

    if (!req.file) throw badRequest('Please attach a file');
    if (!isAllowedMime(req.file.mimetype)) {
      throw badRequest(
        `That file type is not accepted. Please upload one of: ${allowedMimeList().join(', ')}`,
      );
    }

    const profile = await prisma.providerProfile.findUnique({ where: { userId: req.user.id } });
    if (!profile) throw notFound('Provider profile not found');

    const { storageKey, sizeBytes } = await putObject(req.file, `providers/${profile.id}`);

    const doc = await prisma.document.create({
      data: {
        kind,
        providerId: profile.id,
        storageKey,
        fileName: req.file.originalname.slice(0, 200),
        mimeType: req.file.mimetype,
        sizeBytes,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      },
      select: { id: true, kind: true, fileName: true, sizeBytes: true, reviewState: true, createdAt: true },
    });

    res.status(201).json({ document: doc });
  }),
);

/**
 * Add or replace a credential (SOP §4). Jurisdiction is stored separately from
 * the credential itself, and an inspector may hold as many as they need — one
 * per state they serve, plus insurance and any certifications.
 */
providerRouter.put(
  '/me/credentials',
  asyncHandler(async (req, res) => {
    const { credentials } = parse(
      z.object({
        credentials: z
          .array(
            z.object({
              id: z.string().uuid().optional(),
              kind: z.enum(['LICENSE', 'CERTIFICATION', 'INSURANCE', 'BOND', 'OTHER']),
              jurisdiction: z
                .string()
                .trim()
                .length(2, 'Use the two-letter state code')
                .toUpperCase()
                .optional()
                .or(z.literal('').transform(() => undefined)),
              number: z.string().trim().min(2, 'Credential number is required').max(80),
              issuedBy: z.string().trim().max(160).optional(),
              expiresAt: z.string().datetime().optional(),
              documentId: z.string().uuid().optional(),
            }),
          )
          .max(40),
      }),
      req.body,
    );

    const profile = await prisma.providerProfile.findUnique({ where: { userId: req.user.id } });
    if (!profile) throw notFound('Provider profile not found');

    // A state licence without its state cannot be checked against a job's
    // jurisdiction, so it is not a licence as far as eligibility is concerned.
    for (const c of credentials) {
      if (c.kind === 'LICENSE' && !c.jurisdiction) {
        throw badRequest(`Which state is license ${c.number} issued in?`, [
          { field: 'jurisdiction', message: 'Required for a state license' },
        ]);
      }
    }

    // Any document referenced must belong to this provider.
    const docIds = credentials.map((c) => c.documentId).filter(Boolean);
    if (docIds.length) {
      const owned = await prisma.document.count({
        where: { id: { in: docIds }, providerId: profile.id },
      });
      if (owned !== new Set(docIds).size) throw forbidden('That document is not yours');
    }

    const saved = await prisma.$transaction(async (tx) => {
      const keep = [];
      for (const c of credentials) {
        const data = {
          kind: c.kind,
          jurisdiction: c.jurisdiction ?? null,
          number: c.number,
          issuedBy: c.issuedBy ?? null,
          expiresAt: c.expiresAt ? new Date(c.expiresAt) : null,
          documentId: c.documentId ?? null,
          // Editing a credential sends it back for review — an inspector must
          // not be able to swap an approved licence number for another.
          reviewState: 'PENDING',
          reviewNotes: null,
        };

        if (c.id) {
          const existing = await tx.inspectorCredential.findUnique({ where: { id: c.id } });
          if (!existing || existing.providerId !== profile.id) {
            throw forbidden('That credential is not yours');
          }
          keep.push(await tx.inspectorCredential.update({ where: { id: c.id }, data }));
        } else {
          keep.push(await tx.inspectorCredential.create({ data: { ...data, providerId: profile.id } }));
        }
      }

      // Anything the inspector removed from the form is deleted.
      await tx.inspectorCredential.deleteMany({
        where: { providerId: profile.id, id: { notIn: keep.map((k) => k.id) } },
      });

      return keep;
    });

    res.json({ credentials: saved });
  }),
);

/** Submit for admin review. Refuses until the file set is actually complete. */
providerRouter.post(
  '/me/submit',
  asyncHandler(async (req, res) => {
    const profile = await myProfile(req.user.id);

    if (['PENDING', 'APPROVED'].includes(profile.status)) {
      throw conflict(
        profile.status === 'APPROVED'
          ? 'Your account is already approved'
          : 'Your application is already under review',
        'ALREADY_SUBMITTED',
      );
    }

    const have = new Set(
      profile.documents.filter((d) => d.reviewState !== 'REJECTED').map((d) => d.kind),
    );
    const missing = ['IDENTITY', 'LICENSE', 'INSURANCE'].filter((k) => !have.has(k));

    const licensedStates = new Set(
      profile.credentials
        .filter((c) => c.kind === 'LICENSE' && c.reviewState !== 'REJECTED' && c.jurisdiction)
        .map((c) => c.jurisdiction),
    );
    const statesMissingLicense = [...new Set(profile.areas.map((a) => a.area.state))].filter(
      (st) => !licensedStates.has(st),
    );

    const problems = [];
    if (missing.length) problems.push(`missing documents: ${missing.join(', ').toLowerCase()}`);
    if (profile.services.length === 0) problems.push('no services selected');
    if (profile.areas.length === 0) problems.push('no service areas selected');
    if (statesMissingLicense.length) {
      problems.push(`no license on file for ${statesMissingLicense.join(', ')}`);
    }
    if (problems.length) throw badRequest(`Not quite ready to submit — ${problems.join('; ')}`);

    const updated = await prisma.providerProfile.update({
      where: { id: profile.id },
      data: { status: 'PENDING', submittedAt: new Date(), reviewNotes: null },
    });

    res.json({
      profile: { id: updated.id, status: updated.status, submittedAt: updated.submittedAt },
      message: "Thanks — we'll review your documents and let you know shortly",
    });
  }),
);

// ------------------------------------------------------------- job board

providerRouter.get(
  '/jobs/available',
  requireApprovedProvider,
  asyncHandler(async (req, res) => {
    const profile = await prisma.providerProfile.findUnique({
      where: { userId: req.user.id },
      include: { services: true, areas: true },
    });

    const serviceIds = profile.services.map((s) => s.serviceId);
    const areaIds = profile.areas.map((a) => a.serviceAreaId);
    if (serviceIds.length === 0 || areaIds.length === 0) {
      return res.json({ currency: env.currency, jobs: [], note: 'Set your services and areas to see jobs' });
    }

    // Their own commitments, so we can grey out a clashing job in the UI
    // instead of letting them tap and fail.
    const mine = await prisma.job.findMany({
      where: {
        providerId: profile.id,
        status: { in: ['ASSIGNED', 'EN_ROUTE', 'IN_PROGRESS', 'AWAITING_REPORT'] },
      },
      select: { scheduledStart: true, scheduledEnd: true },
    });

    const jobs = await prisma.job.findMany({
      where: {
        status: 'OPEN',
        providerId: null,
        serviceId: { in: serviceIds },
        serviceAreaId: { in: areaIds },
        scheduledStart: { gt: new Date() },
      },
      orderBy: { scheduledStart: 'asc' },
      take: 100,
      select: {
        id: true,
        reference: true,
        scheduledStart: true,
        scheduledEnd: true,
        providerPayCents: true,
        customerNotes: true,
        service: { select: { id: true, name: true, durationMinutes: true, requiresReport: true } },
        area: { select: { id: true, name: true, city: true, state: true } },
        // Street address is withheld until the job is accepted — the suburb is
        // enough to decide, and it protects the customer's address.
        address: { select: { city: true, zip: true } },
      },
    });

    res.json({
      currency: env.currency,
      jobs: jobs.map((j) => ({
        ...j,
        clashes: mine.some((m) => j.scheduledStart < m.scheduledEnd && j.scheduledEnd > m.scheduledStart),
      })),
    });
  }),
);

/** One-tap accept. The race is settled in claimJob. */
providerRouter.post(
  '/jobs/:id/accept',
  requireApprovedProvider,
  asyncHandler(async (req, res) => {
    const profile = await prisma.providerProfile.findUnique({ where: { userId: req.user.id } });
    const job = await claimJob(req.params.id, profile, req.user);

    // Everyone else's board drops it immediately.
    emitJobTaken({ id: job.id, serviceAreaId: job.serviceAreaId, status: job.status, providerId: job.providerId });

    await notifyUser('provider_assigned', job.customer, {
      job,
      service: job.service,
      providerName: job.provider.businessName,
    });

    const full = await prisma.job.findUnique({ where: { id: job.id }, include: jobInclude });
    res.json({ job: full, statusLabel: STATUS_LABELS[full.status], message: "It's yours — details unlocked" });
  }),
);

providerRouter.get(
  '/jobs/mine',
  requireApprovedProvider,
  asyncHandler(async (req, res) => {
    const { scope } = parse(
      z.object({ scope: z.enum(['active', 'past', 'all']).default('active') }),
      req.query,
    );
    const profile = await prisma.providerProfile.findUnique({ where: { userId: req.user.id } });

    const statuses =
      scope === 'active'
        ? ['ASSIGNED', 'EN_ROUTE', 'IN_PROGRESS', 'AWAITING_REPORT']
        : scope === 'past'
          ? ['COMPLETED', 'CANCELLED', 'REFUNDED']
          : undefined;

    const jobs = await prisma.job.findMany({
      where: { providerId: profile.id, ...(statuses ? { status: { in: statuses } } : {}) },
      orderBy: { scheduledStart: scope === 'past' ? 'desc' : 'asc' },
      select: {
        id: true,
        reference: true,
        status: true,
        scheduledStart: true,
        scheduledEnd: true,
        providerPayCents: true,
        service: { select: { name: true, requiresReport: true } },
        address: { select: { line1: true, line2: true, city: true, state: true, zip: true, notes: true } },
        customer: { select: { fullName: true, phone: true } },
        payout: { select: { status: true, amountCents: true, paidAt: true } },
      },
    });

    res.json({
      currency: env.currency,
      jobs: jobs.map((j) => ({ ...j, statusLabel: STATUS_LABELS[j.status] })),
    });
  }),
);

providerRouter.get(
  '/jobs/:id',
  requireApprovedProvider,
  asyncHandler(async (req, res) => {
    const profile = await prisma.providerProfile.findUnique({ where: { userId: req.user.id } });
    const job = await prisma.job.findUnique({ where: { id: req.params.id }, include: jobInclude });
    if (!job) throw notFound('Job not found');
    if (job.providerId !== profile.id) throw forbidden('That job is not assigned to you');

    res.json({
      currency: env.currency,
      job: { ...job, statusLabel: STATUS_LABELS[job.status] },
    });
  }),
);

/**
 * Status progression. The allowed targets are deliberately narrow — a provider
 * cannot mark a job COMPLETED directly if it needs a report; that path runs
 * through AWAITING_REPORT and only the upload closes it.
 */
providerRouter.post(
  '/jobs/:id/status',
  requireApprovedProvider,
  asyncHandler(async (req, res) => {
    const { to, note } = parse(
      z.object({
        to: z.enum(['EN_ROUTE', 'IN_PROGRESS', 'AWAITING_REPORT', 'COMPLETED']),
        note: z.string().trim().max(500).optional(),
      }),
      req.body,
    );

    const profile = await prisma.providerProfile.findUnique({ where: { userId: req.user.id } });
    const job = await prisma.job.findUnique({
      where: { id: req.params.id },
      include: { service: true, customer: true, documents: true },
    });
    if (!job) throw notFound('Job not found');
    if (job.providerId !== profile.id) throw forbidden('That job is not assigned to you');

    // Finishing a job that requires a report, with no report on file, parks it
    // in AWAITING_REPORT rather than completing it.
    let target = to;
    if (to === 'COMPLETED' && job.service.requiresReport) {
      const hasReport = job.documents.some((d) => d.kind === 'JOB_REPORT');
      if (!hasReport) target = 'AWAITING_REPORT';
    }

    const updated = await transitionJob({ jobId: job.id, to: target, actor: req.user, note });

    if (target === 'EN_ROUTE') {
      await notifyUser('provider_en_route', job.customer, {
        job: updated,
        providerName: profile.businessName,
      });
    }
    if (target === 'COMPLETED') {
      await onJobCompleted(updated, job, profile, req.user);
    }
    if (target === 'AWAITING_REPORT') {
      await raiseException({
        jobId: job.id,
        kind: 'REPORT_MISSING',
        detail: `${job.reference} marked done but the required report is not uploaded`,
      });
    }

    const full = await prisma.job.findUnique({ where: { id: job.id }, include: jobInclude });
    emitJobUpdated(full);

    res.json({
      job: full,
      statusLabel: STATUS_LABELS[full.status],
      message:
        target === 'AWAITING_REPORT'
          ? 'Marked done — upload the report to finish the job and release your payment'
          : `Updated to ${STATUS_LABELS[target].toLowerCase()}`,
    });
  }),
);

/** Completion side effects, shared with the report-upload path. */
async function onJobCompleted(updatedJob, job, profile, actor) {
  await notifyUser('job_completed', job.customer, { job: updatedJob, service: job.service });

  // Record what the provider is owed. Payout is released by an admin (or a
  // scheduled run) — completing a job must never move money on its own.
  await prisma.payout.upsert({
    where: { jobId: job.id },
    create: {
      jobId: job.id,
      providerId: profile.id,
      amountCents: job.providerPayCents,
      currency: env.currency,
      status: 'PENDING',
    },
    update: {},
  });

  // Clear a REPORT_MISSING flag if this closes it out.
  await prisma.jobException.updateMany({
    where: { jobId: job.id, kind: 'REPORT_MISSING', status: 'OPEN' },
    data: { status: 'RESOLVED', resolvedAt: new Date(), resolution: 'Report uploaded', resolvedById: actor.id },
  });
}

providerRouter.post(
  '/jobs/:id/documents',
  requireApprovedProvider,
  upload.array('files', 6),
  asyncHandler(async (req, res) => {
    const { kind } = parse(
      z.object({ kind: z.enum(['JOB_REPORT', 'JOB_PHOTO', 'OTHER']).default('JOB_REPORT') }),
      req.body,
    );

    const files = req.files ?? [];
    if (files.length === 0) throw badRequest('Please attach at least one file');
    for (const f of files) {
      if (!isAllowedMime(f.mimetype)) {
        throw badRequest(`${f.originalname}: that file type is not accepted`);
      }
    }

    const profile = await prisma.providerProfile.findUnique({ where: { userId: req.user.id } });
    const job = await prisma.job.findUnique({
      where: { id: req.params.id },
      include: { service: true, customer: true },
    });
    if (!job) throw notFound('Job not found');
    if (job.providerId !== profile.id) throw forbidden('That job is not assigned to you');
    if (['CANCELLED', 'REFUNDED'].includes(job.status)) {
      throw conflict('This job is closed', 'JOB_CLOSED');
    }

    const created = [];
    for (const f of files) {
      const { storageKey, sizeBytes } = await putObject(f, `jobs/${job.id}`);
      created.push(
        await prisma.document.create({
          data: {
            kind,
            jobId: job.id,
            providerId: profile.id,
            storageKey,
            fileName: f.originalname.slice(0, 200),
            mimeType: f.mimetype,
            sizeBytes,
          },
          select: { id: true, kind: true, fileName: true, sizeBytes: true, createdAt: true },
        }),
      );
    }

    // A report arriving is what finishes a job parked in AWAITING_REPORT.
    let completed = false;
    if (kind === 'JOB_REPORT' && job.status === 'AWAITING_REPORT') {
      const updated = await transitionJob({
        jobId: job.id,
        to: 'COMPLETED',
        actor: req.user,
        note: 'Report uploaded',
      });
      await onJobCompleted(updated, job, profile, req.user);
      completed = true;
    }

    const full = await prisma.job.findUnique({ where: { id: job.id }, include: jobInclude });
    if (completed) emitJobUpdated(full);

    res.status(201).json({
      documents: created,
      job: full,
      statusLabel: STATUS_LABELS[full.status],
      message: completed ? 'Report received — job complete and payment queued' : 'Uploaded',
    });
  }),
);

/** Hand a job back. Honest about it: the customer is told and it re-lists. */
providerRouter.post(
  '/jobs/:id/release',
  requireApprovedProvider,
  asyncHandler(async (req, res) => {
    const { reason } = parse(
      z.object({ reason: z.string().trim().min(3, 'Please say why').max(500) }),
      req.body,
    );

    const profile = await prisma.providerProfile.findUnique({ where: { userId: req.user.id } });
    await releaseJob(req.params.id, req.user, { reason, expectProviderId: profile.id });

    await raiseException({
      jobId: req.params.id,
      kind: 'PROVIDER_CANCELLED',
      detail: `${profile.businessName} released the job: ${reason}`,
    });

    const full = await prisma.job.findUnique({ where: { id: req.params.id }, include: jobInclude });
    emitJobReleased(full);

    res.json({ job: full, message: 'Released back to the board' });
  }),
);

// -------------------------------------------------------------- earnings

providerRouter.get(
  '/earnings',
  requireApprovedProvider,
  asyncHandler(async (req, res) => {
    const profile = await prisma.providerProfile.findUnique({ where: { userId: req.user.id } });

    const [pending, paid, payouts, upcomingCount] = await Promise.all([
      prisma.payout.aggregate({
        where: { providerId: profile.id, status: { in: ['PENDING', 'PROCESSING'] } },
        _sum: { amountCents: true },
        _count: true,
      }),
      prisma.payout.aggregate({
        where: { providerId: profile.id, status: 'PAID' },
        _sum: { amountCents: true },
        _count: true,
      }),
      prisma.payout.findMany({
        where: { providerId: profile.id },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          amountCents: true,
          status: true,
          paidAt: true,
          createdAt: true,
          failureReason: true,
          job: { select: { reference: true, service: { select: { name: true } }, completedAt: true } },
        },
      }),
      prisma.job.count({
        where: {
          providerId: profile.id,
          status: { in: ['ASSIGNED', 'EN_ROUTE', 'IN_PROGRESS', 'AWAITING_REPORT'] },
        },
      }),
    ]);

    res.json({
      currency: env.currency,
      summary: {
        pendingCents: pending._sum.amountCents ?? 0,
        pendingCount: pending._count,
        paidCents: paid._sum.amountCents ?? 0,
        paidCount: paid._count,
        upcomingJobs: upcomingCount,
      },
      payouts,
    });
  }),
);
