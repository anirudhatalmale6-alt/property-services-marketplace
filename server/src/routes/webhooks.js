/**
 * Stripe webhooks — the ONLY authority on whether a card payment succeeded.
 *
 * Two properties this route must have:
 *  1. Signature verification on the RAW body. The route is mounted with
 *     express.raw() in app.js, before the JSON parser, because a parsed and
 *     re-serialised body no longer matches the signature.
 *  2. Idempotency. Stripe retries deliveries. Every event id is inserted into
 *     WebhookEvent under a unique constraint, so a replay is recognised and
 *     skipped instead of opening the same job twice.
 */
import express from 'express';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { parseStripeWebhook } from '../services/payments.js';
import { raiseException } from '../services/jobs.js';
import { openPaidJob } from './bookings.js';

export const webhookRouter = express.Router();

webhookRouter.post('/stripe', async (req, res) => {
  if (env.paymentsDriver !== 'stripe') {
    return res.status(400).json({ error: { message: 'Stripe is not the active payment driver' } });
  }

  let event;
  try {
    event = await parseStripeWebhook(req.body, req.headers['stripe-signature']);
  } catch (err) {
    console.error('[webhook] signature verification failed:', err.message);
    return res.status(400).json({ error: { message: `Webhook signature check failed` } });
  }

  // Claim the event.
  //
  // The unique constraint on (provider, externalId) is what makes a replay
  // safe. But "a row already exists" is NOT the same as "already handled": if
  // an earlier delivery inserted the row and then the handler threw, we
  // answered 500 and Stripe is now retrying something we never processed.
  // So the decision is made on processedAt, not on the insert failing.
  try {
    await prisma.webhookEvent.create({
      data: { provider: 'stripe', externalId: event.id, type: event.type, payload: event.data ?? {} },
    });
  } catch (err) {
    if (err.code !== 'P2002') throw err;

    const existing = await prisma.webhookEvent.findUnique({
      where: { provider_externalId: { provider: 'stripe', externalId: event.id } },
      select: { processedAt: true },
    });

    if (existing?.processedAt) {
      console.log(`[webhook] ${event.id} already processed, ignoring replay`);
      return res.json({ received: true, duplicate: true });
    }
    console.log(`[webhook] retrying ${event.id} — previous attempt did not finish`);
  }

  try {
    switch (event.type) {
      case 'payment_intent.succeeded': {
        const intent = event.data.object;
        const payment = await prisma.payment.findFirst({ where: { externalId: intent.id } });
        if (!payment) {
          console.warn(`[webhook] no payment row for intent ${intent.id}`);
          break;
        }

        // Trust the amount Stripe reports, not the one we asked for.
        await prisma.payment.update({
          where: { id: payment.id },
          data: {
            status: 'SUCCEEDED',
            paidAt: new Date(),
            amountCents: intent.amount_received ?? payment.amountCents,
            failureReason: null,
          },
        });

        const job = await prisma.job.findUnique({ where: { id: payment.jobId } });
        if (job?.status === 'PENDING_PAYMENT') {
          await openPaidJob(job.id, { id: null, role: 'ADMIN' });
        }
        break;
      }

      case 'payment_intent.payment_failed': {
        const intent = event.data.object;
        const payment = await prisma.payment.findFirst({ where: { externalId: intent.id } });
        if (!payment) break;

        await prisma.payment.update({
          where: { id: payment.id },
          data: {
            status: 'FAILED',
            failureReason: intent.last_payment_error?.message?.slice(0, 500) ?? 'Payment failed',
          },
        });
        await raiseException({
          jobId: payment.jobId,
          kind: 'PAYMENT_FAILED',
          detail: intent.last_payment_error?.message ?? 'Card payment failed at Stripe',
        });
        break;
      }

      case 'charge.refunded': {
        const charge = event.data.object;
        const payment = await prisma.payment.findFirst({
          where: { externalId: charge.payment_intent },
        });
        if (!payment) break;

        await prisma.payment.update({
          where: { id: payment.id },
          data: {
            status: 'REFUNDED',
            refundedCents: charge.amount_refunded ?? payment.amountCents,
            refundedAt: new Date(),
          },
        });
        break;
      }

      case 'transfer.failed': {
        const transfer = event.data.object;
        const payout = await prisma.payout.findFirst({ where: { externalId: transfer.id } });
        if (!payout) break;

        await prisma.payout.update({
          where: { id: payout.id },
          data: { status: 'FAILED', failureReason: 'Transfer failed at Stripe' },
        });
        await raiseException({
          jobId: payout.jobId,
          kind: 'PAYOUT_FAILED',
          detail: `Stripe transfer ${transfer.id} failed`,
        });
        break;
      }

      default:
        // Unhandled types are recorded above and acknowledged; Stripe should
        // not keep retrying something we simply do not act on.
        break;
    }

    await prisma.webhookEvent.update({
      where: { provider_externalId: { provider: 'stripe', externalId: event.id } },
      data: { processedAt: new Date() },
    });

    return res.json({ received: true });
  } catch (err) {
    // processedAt stays null and we answer 500, so Stripe retries. The retry
    // finds the existing row unprocessed and runs the handler again — see the
    // claim block above.
    console.error('[webhook] handler failed:', err);
    return res.status(500).json({ error: { message: 'Webhook handling failed' } });
  }
});
