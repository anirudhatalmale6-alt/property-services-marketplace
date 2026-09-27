/**
 * Customer side: book, pay, track.
 *
 * Booking and payment are two steps on purpose. The job is created
 * PENDING_PAYMENT and only reaches the marketplace (OPEN) once money has
 * actually cleared — so an abandoned checkout never dispatches a provider.
 */
import express from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { asyncHandler, badRequest, conflict, forbidden, notFound, parse } from '../lib/http.js';
import { requireAuth, requireRole } from '../lib/auth.js';
import { validateSlot } from '../services/slots.js';
import {
  ACTIVE_STATUSES,
  STATUS_LABELS,
  jobInclude,
  raiseException,
  transitionJob,
  uniqueReference,
} from '../services/jobs.js';
import { confirmMockPayment, createPaymentIntent, refundPayment } from '../services/payments.js';
import { notifyMany, notifyUser } from '../services/notify.js';
import { findEligibleProviders } from '../services/assignment.js';
import { quote, validatePropertyDetails } from '../services/pricing.js';
import { emitJobOpened, emitJobUpdated } from '../realtime.js';

export const bookingRouter = express.Router();
bookingRouter.use(requireAuth);

const addressSchema = z.object({
  label: z.string().trim().max(60).optional(),
  line1: z.string().trim().min(3, 'Street address is required').max(200),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(2, 'City is required').max(120),
  state: z.string().trim().min(2, 'State is required').max(2).toUpperCase(),
  zip: z.string().trim().regex(/^\d{5}(-\d{4})?$/, 'Enter a 5-digit ZIP code'),
  country: z.string().trim().length(2).default('US'),
  notes: z.string().trim().max(500).optional(),
});

// ------------------------------------------------------------- addresses

bookingRouter.get(
  '/addresses',
  asyncHandler(async (req, res) => {
    const addresses = await prisma.address.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ addresses });
  }),
);

bookingRouter.post(
  '/addresses',
  asyncHandler(async (req, res) => {
    const body = parse(addressSchema, req.body);
    const address = await prisma.address.create({ data: { ...body, userId: req.user.id } });
    res.status(201).json({ address });
  }),
);

// -------------------------------------------------------------- booking

const createBookingSchema = z.object({
  serviceId: z.string().uuid('Please choose a service'),
  scheduledStart: z.string().datetime('Please choose an appointment time'),
  customerNotes: z.string().trim().max(1000).optional(),
  // Either reuse a saved address or send a new one.
  addressId: z.string().uuid().optional(),
  address: addressSchema.optional(),

  // Property details that feed the price (SOP §3.3).
  squareFeet: z.coerce.number().int().positive().optional(),
  yearBuilt: z.coerce.number().int().optional(),
  addOnIds: z.array(z.string().uuid()).max(20).default([]),

  // Who is paying (SOP §3.5).
  payerType: z.enum(['CUSTOMER', 'REALTOR', 'COMPANY']).default('CUSTOMER'),
  payerName: z.string().trim().max(160).optional(),
});

bookingRouter.post(
  '/',
  requireRole('CUSTOMER', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const body = parse(createBookingSchema, req.body);

    if (!body.addressId && !body.address) {
      throw badRequest('We need the property address', [
        { field: 'address', message: 'Provide an address or choose a saved one' },
      ]);
    }

    const service = await prisma.service.findUnique({ where: { id: body.serviceId } });
    if (!service || !service.isActive) throw notFound('That service is not available');

    // Resolve the address, verifying ownership of a saved one.
    let address;
    if (body.addressId) {
      address = await prisma.address.findUnique({ where: { id: body.addressId } });
      if (!address || address.userId !== req.user.id) throw notFound('That saved address was not found');
    } else {
      address = await prisma.address.create({ data: { ...body.address, userId: req.user.id } });
    }

    // Which market is this? No live ServiceArea means we do not operate there.
    const area = await prisma.serviceArea.findFirst({
      where: { zip: address.zip, isActive: true },
    });
    if (!area) {
      throw badRequest(
        `We don't cover zip ${address.zip} yet — we'll let you know when we do`,
        [{ field: 'address.zip', message: 'Outside our service areas' }],
      );
    }

    const slot = await validateSlot({
      serviceId: service.id,
      zip: address.zip,
      start: body.scheduledStart,
    });
    if (!slot.ok) {
      throw badRequest(slot.reason, [{ field: 'scheduledStart', message: slot.reason }]);
    }

    // Property details drive the price, so they are validated against what
    // this particular service actually asks for.
    const detailErrors = validatePropertyDetails(service, {
      squareFeet: body.squareFeet,
      yearBuilt: body.yearBuilt,
    });
    if (detailErrors.length) {
      throw badRequest('We need a couple more details about the property', detailErrors);
    }

    // Price the job server-side. The browser shows an estimate; this is the
    // number that binds, so a tampered payload cannot buy a cheap inspection.
    const priced = await quote({
      service,
      squareFeet: body.squareFeet,
      yearBuilt: body.yearBuilt,
      addOnIds: body.addOnIds,
    });

    const job = await prisma.job.create({
      data: {
        reference: await uniqueReference(),
        customerId: req.user.id,
        serviceId: service.id,
        addressId: address.id,
        serviceAreaId: area.id,
        status: 'PENDING_PAYMENT',
        scheduledStart: slot.start,
        scheduledEnd: slot.end,
        customerNotes: body.customerNotes ?? null,
        squareFeet: body.squareFeet ?? null,
        yearBuilt: body.yearBuilt ?? null,
        payerType: body.payerType,
        payerName: body.payerName ?? null,
        // Snapshot the price AND how it was reached. A later catalogue or fee
        // change must not alter what this customer was quoted, nor what the
        // inspector was promised.
        priceCents: priced.priceCents,
        providerPayCents: priced.providerPayCents,
        priceBreakdown: priced.breakdown,
        events: {
          create: {
            toStatus: 'PENDING_PAYMENT',
            actorId: req.user.id,
            actorRole: req.user.role,
            note: 'Booking created',
          },
        },
      },
      include: jobInclude,
    });

    const intent = await createPaymentIntent(job);

    res.status(201).json({ job, payment: intent, statusLabel: STATUS_LABELS[job.status] });
  }),
);

/** Re-open checkout for a booking that was created but never paid. */
bookingRouter.post(
  '/:id/payment-intent',
  asyncHandler(async (req, res) => {
    const job = await prisma.job.findUnique({ where: { id: req.params.id } });
    if (!job) throw notFound('Booking not found');
    if (job.customerId !== req.user.id && req.user.role !== 'ADMIN') {
      throw forbidden('That is not your booking');
    }
    if (job.status !== 'PENDING_PAYMENT') {
      throw conflict('This booking is not awaiting payment', 'NOT_PAYABLE');
    }

    const intent = await createPaymentIntent(job);
    res.json({ payment: intent });
  }),
);

/**
 * Mock-driver checkout completion.
 *
 * With Stripe the browser NEVER tells us a payment succeeded — the webhook
 * does. This route exists so the flow is demoable before Stripe keys exist,
 * and `confirmMockPayment` refuses to run on the live driver or in production.
 */
bookingRouter.post(
  '/:id/confirm-mock-payment',
  asyncHandler(async (req, res) => {
    const { succeed } = parse(z.object({ succeed: z.boolean().default(true) }), req.body ?? {});

    const job = await prisma.job.findUnique({ where: { id: req.params.id } });
    if (!job) throw notFound('Booking not found');
    if (job.customerId !== req.user.id && req.user.role !== 'ADMIN') {
      throw forbidden('That is not your booking');
    }
    if (job.status !== 'PENDING_PAYMENT') {
      throw conflict('This booking is not awaiting payment', 'NOT_PAYABLE');
    }

    await confirmMockPayment(job.id, succeed);

    if (!succeed) {
      await raiseException({
        jobId: job.id,
        kind: 'PAYMENT_FAILED',
        detail: `Card declined at checkout for ${job.reference}`,
      });
      const fresh = await prisma.job.findUnique({ where: { id: job.id }, include: jobInclude });
      return res.status(402).json({
        job: fresh,
        message: 'That payment was declined — please try another card',
      });
    }

    const opened = await openPaidJob(job.id, req.user);
    return res.json({ job: opened, statusLabel: STATUS_LABELS[opened.status] });
  }),
);

/**
 * Shared "money cleared, put it on the board" path. Called by the mock
 * confirm route and by the Stripe webhook, so both produce identical state.
 */
export async function openPaidJob(jobId, actor) {
  await transitionJob({
    jobId,
    to: 'OPEN',
    actor,
    note: 'Payment received — listed on the marketplace',
  });

  const job = await prisma.job.findUnique({ where: { id: jobId }, include: jobInclude });

  // Tell the customer, then every provider who could take it.
  await notifyUser('booking_confirmed', job.customer, { job, service: job.service });

  const eligible = await findEligibleProviders(job);
  if (eligible.length === 0) {
    await raiseException({
      jobId: job.id,
      kind: 'NO_PROVIDER_FOUND',
      detail: `No approved provider covers ${job.service.name} in ${job.area?.name ?? 'that area'}`,
    });
  } else {
    await notifyMany('new_job_available', eligible, {
      job,
      service: job.service,
      areaName: job.area?.name ?? 'your area',
    });
  }

  emitJobOpened({
    id: job.id,
    reference: job.reference,
    serviceAreaId: job.serviceAreaId,
    status: job.status,
    serviceName: job.service.name,
    scheduledStart: job.scheduledStart,
    providerPayCents: job.providerPayCents,
    suburb: job.address.city,
  });

  return job;
}

// -------------------------------------------------------------- tracking

bookingRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { scope } = parse(
      z.object({ scope: z.enum(['active', 'past', 'all']).default('all') }),
      req.query,
    );

    const statusFilter =
      scope === 'active'
        ? { in: ACTIVE_STATUSES }
        : scope === 'past'
          ? { in: ['COMPLETED', 'CANCELLED', 'REFUNDED'] }
          : undefined;

    const jobs = await prisma.job.findMany({
      where: { customerId: req.user.id, ...(statusFilter ? { status: statusFilter } : {}) },
      orderBy: { scheduledStart: 'desc' },
      include: {
        service: { select: { name: true, slug: true } },
        address: { select: { line1: true, city: true, zip: true } },
        provider: { select: { businessName: true } },
        payment: { select: { status: true, amountCents: true } },
      },
    });

    res.json({
      currency: env.currency,
      jobs: jobs.map((j) => ({ ...j, statusLabel: STATUS_LABELS[j.status] })),
    });
  }),
);

bookingRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const job = await prisma.job.findUnique({ where: { id: req.params.id }, include: jobInclude });
    if (!job) throw notFound('Booking not found');
    if (job.customerId !== req.user.id && req.user.role !== 'ADMIN') {
      throw forbidden('That is not your booking');
    }

    res.json({
      currency: env.currency,
      job: { ...job, statusLabel: STATUS_LABELS[job.status] },
      timeline: job.events.map((e) => ({
        at: e.createdAt,
        status: e.toStatus,
        label: STATUS_LABELS[e.toStatus],
        note: e.note,
      })),
    });
  }),
);

/**
 * Customer cancellation. Inside the free window it refunds automatically;
 * closer to the appointment it raises an exception for an admin to decide,
 * rather than silently keeping the money.
 */
const FREE_CANCEL_HOURS = 24;

bookingRouter.post(
  '/:id/cancel',
  asyncHandler(async (req, res) => {
    const { reason } = parse(
      z.object({ reason: z.string().trim().max(500).optional() }),
      req.body ?? {},
    );

    const job = await prisma.job.findUnique({
      where: { id: req.params.id },
      include: { payment: true, service: true, customer: true, provider: { select: { userId: true } } },
    });
    if (!job) throw notFound('Booking not found');
    if (job.customerId !== req.user.id && req.user.role !== 'ADMIN') {
      throw forbidden('That is not your booking');
    }
    if (!ACTIVE_STATUSES.includes(job.status)) {
      throw conflict('This booking can no longer be cancelled', 'NOT_CANCELLABLE');
    }

    const hoursOut = (new Date(job.scheduledStart) - Date.now()) / 3_600_000;
    const freeWindow = hoursOut >= FREE_CANCEL_HOURS || req.user.role === 'ADMIN';

    await transitionJob({
      jobId: job.id,
      to: 'CANCELLED',
      actor: req.user,
      note: reason ? `Cancelled by customer: ${reason}` : 'Cancelled by customer',
      data: { cancelReason: reason ?? null, providerId: null },
    });

    let refunded = false;
    if (job.payment?.status === 'SUCCEEDED') {
      if (freeWindow) {
        await refundPayment(job.payment);
        await transitionJob({
          jobId: job.id,
          to: 'REFUNDED',
          actor: req.user,
          note: 'Full refund issued (cancelled outside the charge window)',
        });
        refunded = true;
      } else {
        await raiseException({
          jobId: job.id,
          kind: 'REFUND_REQUESTED',
          detail: `Cancelled ${hoursOut.toFixed(1)}h before the appointment — refund needs a decision`,
        });
      }
    }

    const fresh = await prisma.job.findUnique({ where: { id: job.id }, include: jobInclude });
    await notifyUser('job_cancelled', job.customer, { job: fresh, reason });
    emitJobUpdated(fresh);

    res.json({
      job: { ...fresh, statusLabel: STATUS_LABELS[fresh.status] },
      refunded,
      message: refunded
        ? 'Your booking is cancelled and a full refund is on its way'
        : freeWindow
          ? 'Your booking is cancelled'
          : `Cancelled. Because it is within ${FREE_CANCEL_HOURS} hours of the appointment, our team will review the refund and be in touch`,
    });
  }),
);
