/**
 * Payment + payout adapter.
 *
 * Two drivers:
 *   "stripe" — real Stripe PaymentIntents and Transfers.
 *   "mock"   — simulates the same shapes locally. This exists so the whole
 *              booking flow is testable and demoable BEFORE any Stripe account
 *              is opened. Switching is one env var; no calling code changes.
 *
 * The mock driver refuses to load in production, so it can never quietly
 * become the live payment path.
 */
import crypto from 'node:crypto';
import { env, isProd } from '../env.js';
import { prisma } from '../db.js';

let stripe = null;
async function getStripe() {
  if (stripe) return stripe;
  const { default: Stripe } = await import('stripe');
  stripe = new Stripe(env.stripeSecretKey, { apiVersion: '2024-12-18.acacia' });
  return stripe;
}

function assertMockAllowed() {
  if (isProd) {
    throw new Error(
      'PAYMENTS_DRIVER=mock is refused in production — set real Stripe keys before going live',
    );
  }
}

// -------------------------------------------------------------- customer pay

/**
 * Create (or reuse) the intent a customer will pay with, and persist it
 * against the job's Payment row.
 *
 * @returns {{clientSecret:string, publishableKey:string, driver:string, amountCents:number}}
 */
export async function createPaymentIntent(job) {
  const existing = await prisma.payment.findUnique({ where: { jobId: job.id } });

  if (existing?.status === 'SUCCEEDED') {
    const err = new Error('This booking is already paid');
    err.status = 409;
    throw err;
  }

  if (env.paymentsDriver === 'stripe') {
    const client = await getStripe();
    const intent = await client.paymentIntents.create({
      amount: job.priceCents,
      currency: env.currency.toLowerCase(),
      automatic_payment_methods: { enabled: true },
      metadata: { jobId: job.id, reference: job.reference },
      description: `${job.reference} — property service booking`,
    });

    await prisma.payment.upsert({
      where: { jobId: job.id },
      create: {
        jobId: job.id,
        amountCents: job.priceCents,
        currency: env.currency,
        provider: 'stripe',
        externalId: intent.id,
        clientSecret: intent.client_secret,
        status: 'REQUIRES_PAYMENT',
      },
      update: {
        externalId: intent.id,
        clientSecret: intent.client_secret,
        amountCents: job.priceCents,
        status: 'REQUIRES_PAYMENT',
        failureReason: null,
      },
    });

    return {
      clientSecret: intent.client_secret,
      publishableKey: env.stripePublishableKey,
      driver: 'stripe',
      amountCents: job.priceCents,
    };
  }

  assertMockAllowed();
  const fakeId = `pi_mock_${crypto.randomBytes(10).toString('hex')}`;
  const fakeSecret = `${fakeId}_secret_${crypto.randomBytes(8).toString('hex')}`;

  await prisma.payment.upsert({
    where: { jobId: job.id },
    create: {
      jobId: job.id,
      amountCents: job.priceCents,
      currency: env.currency,
      provider: 'mock',
      externalId: fakeId,
      clientSecret: fakeSecret,
      status: 'REQUIRES_PAYMENT',
    },
    update: {
      externalId: fakeId,
      clientSecret: fakeSecret,
      amountCents: job.priceCents,
      status: 'REQUIRES_PAYMENT',
      failureReason: null,
    },
  });

  return {
    clientSecret: fakeSecret,
    publishableKey: 'pk_mock',
    driver: 'mock',
    amountCents: job.priceCents,
  };
}

/**
 * Confirm a mock payment. Only reachable on the mock driver — with Stripe the
 * truth arrives via webhook, never from the browser.
 *
 * @param {boolean} succeed simulate a decline by passing false
 */
export async function confirmMockPayment(jobId, succeed = true) {
  assertMockAllowed();
  if (env.paymentsDriver === 'stripe') {
    const err = new Error('Not available on the live payment driver');
    err.status = 400;
    throw err;
  }

  return prisma.payment.update({
    where: { jobId },
    data: succeed
      ? { status: 'SUCCEEDED', paidAt: new Date(), failureReason: null }
      : { status: 'FAILED', failureReason: 'Card declined (simulated)' },
  });
}

export async function refundPayment(payment, amountCents) {
  const amount = amountCents ?? payment.amountCents - payment.refundedCents;
  if (amount <= 0) return payment;

  if (payment.provider === 'stripe') {
    const client = await getStripe();
    await client.refunds.create({ payment_intent: payment.externalId, amount });
  } else {
    assertMockAllowed();
  }

  return prisma.payment.update({
    where: { id: payment.id },
    data: {
      status: 'REFUNDED',
      refundedCents: payment.refundedCents + amount,
      refundedAt: new Date(),
    },
  });
}

// ------------------------------------------------------------ provider payout

/**
 * Pay a provider for a completed job. Marks the payout PROCESSING first so a
 * crash mid-transfer leaves a state the exceptions queue can see, rather than
 * a PENDING row that looks untouched.
 */
export async function sendPayout(payout, provider) {
  await prisma.payout.update({ where: { id: payout.id }, data: { status: 'PROCESSING' } });

  try {
    let externalId;

    if (env.paymentsDriver === 'stripe') {
      if (!provider.payoutRef) {
        throw new Error('Provider has no connected payout account yet');
      }
      const client = await getStripe();
      const transfer = await client.transfers.create({
        amount: payout.amountCents,
        currency: env.currency.toLowerCase(),
        destination: provider.payoutRef,
        metadata: { payoutId: payout.id, jobId: payout.jobId },
      });
      externalId = transfer.id;
    } else {
      assertMockAllowed();
      externalId = `tr_mock_${crypto.randomBytes(10).toString('hex')}`;
    }

    return await prisma.payout.update({
      where: { id: payout.id },
      data: { status: 'PAID', externalId, paidAt: new Date(), failureReason: null },
    });
  } catch (err) {
    await prisma.payout.update({
      where: { id: payout.id },
      data: { status: 'FAILED', failureReason: String(err.message).slice(0, 500) },
    });
    await prisma.jobException.create({
      data: {
        jobId: payout.jobId,
        kind: 'PAYOUT_FAILED',
        detail: `Payout ${payout.id} failed: ${err.message}`.slice(0, 500),
      },
    });
    throw err;
  }
}

/**
 * Verify and parse a Stripe webhook. Returns the event, or throws — an
 * unverifiable signature must never be trusted.
 */
export async function parseStripeWebhook(rawBody, signature) {
  const client = await getStripe();
  return client.webhooks.constructEvent(rawBody, signature, env.stripeWebhookSecret);
}
