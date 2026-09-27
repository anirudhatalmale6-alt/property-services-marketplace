/**
 * Real-time job acceptance.
 *
 * This is the one piece of the marketplace where a bug costs real money: two
 * providers tapping "Accept" on the same job within milliseconds of each other
 * must not both end up assigned, or two people drive to one property and the
 * platform owes two payouts for one fee.
 *
 * The claim is a single conditional UPDATE:
 *
 *   UPDATE "Job" SET providerId = :me, status = 'ASSIGNED'
 *    WHERE id = :job AND status = 'OPEN' AND providerId IS NULL
 *
 * Postgres takes a row lock for the duration. The second transaction to arrive
 * blocks, then re-evaluates the WHERE clause against the committed row, sees
 * status = 'ASSIGNED', and matches zero rows. `count === 0` is therefore a
 * definitive "someone else got it" — not a guess, and no read-then-write gap
 * for a racer to slip through.
 *
 * The provider's own double-booking check runs inside the same transaction, so
 * a provider who somehow fires two accepts at once still cannot take two
 * overlapping jobs: the second rolls back and releases the claim.
 */
import { prisma } from '../db.js';
import { conflict, forbidden, notFound } from '../lib/http.js';

/** Jobs a provider is already committed to that would clash with [start,end). */
async function findOverlapping(tx, providerId, start, end, excludeJobId) {
  return tx.job.findFirst({
    where: {
      providerId,
      id: excludeJobId ? { not: excludeJobId } : undefined,
      status: { in: ['ASSIGNED', 'EN_ROUTE', 'IN_PROGRESS', 'AWAITING_REPORT'] },
      // Two windows overlap when each starts before the other ends.
      scheduledStart: { lt: end },
      scheduledEnd: { gt: start },
    },
    select: { id: true, reference: true, scheduledStart: true },
  });
}

/**
 * Claim an open job for a provider.
 *
 * @param {string} jobId
 * @param {{id:string}} provider the ProviderProfile
 * @param {{id:string, role:string}} actor the acting User, for the audit trail
 * @returns {Promise<object>} the assigned job
 * @throws 409 if another provider won it, or it clashes with their own work
 */
export async function claimJob(jobId, provider, actor) {
  return prisma.$transaction(async (tx) => {
    const job = await tx.job.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        reference: true,
        status: true,
        providerId: true,
        serviceId: true,
        serviceAreaId: true,
        scheduledStart: true,
        scheduledEnd: true,
      },
    });

    if (!job) throw notFound('That job no longer exists');

    if (job.status !== 'OPEN' || job.providerId) {
      throw conflict('Another provider just accepted this job', 'JOB_TAKEN');
    }

    // Eligibility: the provider must offer this service and cover this area.
    // Checked here rather than only in the feed query, so a stale page or a
    // hand-crafted request cannot bypass it.
    const offersService = await tx.providerService.findUnique({
      where: { providerId_serviceId: { providerId: provider.id, serviceId: job.serviceId } },
      select: { providerId: true },
    });
    if (!offersService) {
      throw forbidden('This job is for a service you are not set up to provide');
    }

    if (job.serviceAreaId) {
      const coversArea = await tx.providerServiceArea.findUnique({
        where: {
          providerId_serviceAreaId: { providerId: provider.id, serviceAreaId: job.serviceAreaId },
        },
        select: { providerId: true },
      });
      if (!coversArea) throw forbidden('This job is outside the areas you cover');
    }

    const clash = await findOverlapping(
      tx,
      provider.id,
      job.scheduledStart,
      job.scheduledEnd,
      job.id,
    );
    if (clash) {
      throw conflict(
        `This clashes with job ${clash.reference} you have already accepted`,
        'PROVIDER_DOUBLE_BOOKED',
      );
    }

    // The atomic claim. Zero rows means we lost the race.
    const { count } = await tx.job.updateMany({
      where: { id: jobId, status: 'OPEN', providerId: null },
      data: { providerId: provider.id, status: 'ASSIGNED', assignedAt: new Date() },
    });

    if (count === 0) {
      throw conflict('Another provider just accepted this job', 'JOB_TAKEN');
    }

    await tx.jobEvent.create({
      data: {
        jobId,
        fromStatus: 'OPEN',
        toStatus: 'ASSIGNED',
        actorId: actor.id,
        actorRole: actor.role,
        note: 'Accepted from the job board',
      },
    });

    return tx.job.findUnique({
      where: { id: jobId },
      include: {
        service: true,
        address: true,
        customer: { select: { id: true, fullName: true, email: true, phone: true } },
        provider: { select: { id: true, businessName: true, userId: true } },
      },
    });
  });
}

/**
 * Release a job back to the board (provider drops it, or admin unassigns).
 * Uses the same conditional-update discipline so releasing a job that has
 * already moved on cannot silently wipe another provider's assignment.
 */
export async function releaseJob(jobId, actor, { reason, expectProviderId } = {}) {
  return prisma.$transaction(async (tx) => {
    const job = await tx.job.findUnique({
      where: { id: jobId },
      select: { id: true, status: true, providerId: true },
    });
    if (!job) throw notFound('Job not found');

    if (expectProviderId && job.providerId !== expectProviderId) {
      throw forbidden('This job is not assigned to you');
    }
    if (!['ASSIGNED', 'EN_ROUTE'].includes(job.status)) {
      throw conflict('This job can no longer be released', 'NOT_RELEASABLE');
    }

    const { count } = await tx.job.updateMany({
      where: { id: jobId, status: job.status, providerId: job.providerId },
      data: { providerId: null, status: 'OPEN', assignedAt: null },
    });
    if (count === 0) throw conflict('This job changed while you were releasing it', 'STALE');

    await tx.jobEvent.create({
      data: {
        jobId,
        fromStatus: job.status,
        toStatus: 'OPEN',
        actorId: actor.id,
        actorRole: actor.role,
        note: reason || 'Released back to the job board',
      },
    });

    return tx.job.findUnique({ where: { id: jobId } });
  });
}

/**
 * Admin force-assign. Bypasses the marketplace but keeps every invariant that
 * protects the data: the provider must be approved, and must not be double
 * booked.
 */
export async function assignJobToProvider(jobId, providerId, actor, note) {
  return prisma.$transaction(async (tx) => {
    const job = await tx.job.findUnique({
      where: { id: jobId },
      select: { id: true, status: true, providerId: true, scheduledStart: true, scheduledEnd: true },
    });
    if (!job) throw notFound('Job not found');
    if (!['OPEN', 'ASSIGNED', 'EN_ROUTE'].includes(job.status)) {
      throw conflict('This job cannot be reassigned at its current status', 'NOT_ASSIGNABLE');
    }

    const provider = await tx.providerProfile.findUnique({
      where: { id: providerId },
      select: { id: true, status: true, businessName: true, userId: true },
    });
    if (!provider) throw notFound('Provider not found');
    if (provider.status !== 'APPROVED') {
      throw conflict('That provider is not approved for work', 'PROVIDER_NOT_APPROVED');
    }

    const clash = await findOverlapping(
      tx,
      providerId,
      job.scheduledStart,
      job.scheduledEnd,
      job.id,
    );
    if (clash) {
      throw conflict(
        `${provider.businessName} is already on job ${clash.reference} at that time`,
        'PROVIDER_DOUBLE_BOOKED',
      );
    }

    const { count } = await tx.job.updateMany({
      where: { id: jobId, status: job.status },
      data: { providerId, status: 'ASSIGNED', assignedAt: new Date() },
    });
    if (count === 0) throw conflict('This job changed while you were assigning it', 'STALE');

    await tx.jobEvent.create({
      data: {
        jobId,
        fromStatus: job.status,
        toStatus: 'ASSIGNED',
        actorId: actor.id,
        actorRole: actor.role,
        note: note || `Assigned to ${provider.businessName} by admin`,
      },
    });

    return tx.job.findUnique({
      where: { id: jobId },
      include: {
        service: true,
        customer: { select: { id: true, fullName: true, email: true, phone: true } },
        provider: { select: { id: true, businessName: true, userId: true } },
      },
    });
  });
}

/**
 * Providers who should hear about a job landing on the board: approved, offer
 * the service, cover the area.
 */
export async function findEligibleProviders(job) {
  const providers = await prisma.providerProfile.findMany({
    where: {
      status: 'APPROVED',
      services: { some: { serviceId: job.serviceId } },
      ...(job.serviceAreaId ? { areas: { some: { serviceAreaId: job.serviceAreaId } } } : {}),
    },
    select: { id: true, user: { select: { id: true, email: true, phone: true, fullName: true } } },
  });
  return providers.map((p) => ({ providerId: p.id, ...p.user }));
}
