/**
 * Notification dispatcher.
 *
 * Every message is written to the Notification table BEFORE we try to send it,
 * then marked SENT or FAILED. That means the admin dashboard can always answer
 * "did the customer get told?" — including for messages that failed, which is
 * exactly the case you need a record of.
 *
 * Drivers: "log" (dev — records it, prints it, sends nothing) and the real
 * SMTP / Twilio senders. No route or job handler knows which is in use.
 */
import nodemailer from 'nodemailer';
import { prisma } from '../db.js';
import { env } from '../env.js';

let mailTransport = null;
function getMailTransport() {
  if (mailTransport) return mailTransport;
  mailTransport = nodemailer.createTransport({
    host: env.smtpHost,
    port: env.smtpPort,
    secure: env.smtpPort === 465,
    auth: env.smtpUser ? { user: env.smtpUser, pass: env.smtpPass } : undefined,
  });
  return mailTransport;
}

let twilioClient = null;
async function getTwilioClient() {
  if (twilioClient) return twilioClient;
  const { default: twilio } = await import('twilio');
  twilioClient = twilio(env.twilioAccountSid, env.twilioAuthToken);
  return twilioClient;
}

const money = (cents, currency = env.currency) =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency }).format(cents / 100);

const when = (date) =>
  new Intl.DateTimeFormat('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(date));

/**
 * Message templates. Each returns { subject, email, sms }; a null sms means
 * "this one is not worth a text message" (SMS costs money per send).
 */
export const templates = {
  booking_confirmed: ({ job, service }) => ({
    subject: `Booking confirmed — ${service.name} (${job.reference})`,
    email: [
      `Your booking is confirmed.`,
      ``,
      `Service:   ${service.name}`,
      `Reference: ${job.reference}`,
      `When:      ${when(job.scheduledStart)}`,
      `Paid:      ${money(job.priceCents)}`,
      ``,
      `We're matching you with a qualified provider now and will let you know`,
      `the moment someone is assigned.`,
      ``,
      `Track your booking: ${env.appUrl}/orders/${job.id}`,
    ].join('\n'),
    sms: `Booking ${job.reference} confirmed for ${when(job.scheduledStart)}. Track it: ${env.appUrl}/orders/${job.id}`,
  }),

  provider_assigned: ({ job, service, providerName }) => ({
    subject: `${providerName} is assigned to your booking (${job.reference})`,
    email: [
      `Good news — ${providerName} has accepted your ${service.name} booking.`,
      ``,
      `Reference: ${job.reference}`,
      `When:      ${when(job.scheduledStart)}`,
      ``,
      `Track your booking: ${env.appUrl}/orders/${job.id}`,
    ].join('\n'),
    sms: `${providerName} is assigned to booking ${job.reference} on ${when(job.scheduledStart)}.`,
  }),

  provider_en_route: ({ job, providerName }) => ({
    subject: `${providerName} is on the way (${job.reference})`,
    email: `${providerName} is on the way to your property for booking ${job.reference}.`,
    sms: `${providerName} is on the way for booking ${job.reference}.`,
  }),

  job_completed: ({ job, service }) => ({
    subject: `${service.name} complete — ${job.reference}`,
    email: [
      `Your ${service.name} is complete.`,
      ``,
      `Reference: ${job.reference}`,
      ``,
      `Any report or photos are on your booking page:`,
      `${env.appUrl}/orders/${job.id}`,
    ].join('\n'),
    sms: `Booking ${job.reference} is complete. View it: ${env.appUrl}/orders/${job.id}`,
  }),

  job_cancelled: ({ job, reason }) => ({
    subject: `Booking cancelled — ${job.reference}`,
    email: [
      `Your booking ${job.reference} has been cancelled.`,
      reason ? `\nReason: ${reason}` : '',
      `\nIf a payment was taken it is being refunded and will appear on your`,
      `statement within a few business days.`,
    ].join('\n'),
    sms: `Booking ${job.reference} has been cancelled. Any payment is being refunded.`,
  }),

  // --- provider-facing ---

  new_job_available: ({ job, service, areaName }) => ({
    subject: `New job available — ${service.name}, ${areaName}`,
    email: [
      `A new job just landed on the board in your area.`,
      ``,
      `Service: ${service.name}`,
      `Area:    ${areaName}`,
      `When:    ${when(job.scheduledStart)}`,
      `Pays:    ${money(job.providerPayCents)}`,
      ``,
      `First to accept gets it: ${env.appUrl}/provider/jobs`,
    ].join('\n'),
    sms: `New job: ${service.name} in ${areaName}, ${when(job.scheduledStart)}, pays ${money(job.providerPayCents)}. ${env.appUrl}/provider/jobs`,
  }),

  provider_approved: ({ providerName }) => ({
    subject: `You're approved — start accepting jobs`,
    email: [
      `Welcome aboard, ${providerName}.`,
      ``,
      `Your documents have been verified and your account is approved. You can`,
      `now see and accept available jobs:`,
      ``,
      `${env.appUrl}/provider/jobs`,
    ].join('\n'),
    sms: `You're approved. Start accepting jobs: ${env.appUrl}/provider/jobs`,
  }),

  provider_rejected: ({ providerName, reason }) => ({
    subject: `About your provider application`,
    email: [
      `Hi ${providerName},`,
      ``,
      `We weren't able to approve your provider application at this time.`,
      reason ? `\n${reason}\n` : '',
      `If you believe this is a mistake, or you have updated documents to`,
      `submit, reply to this message and we'll take another look.`,
    ].join('\n'),
    sms: null,
  }),

  report_required: ({ job }) => ({
    subject: `Report still needed for ${job.reference}`,
    email: `Job ${job.reference} is marked done but the required report has not been uploaded yet. Payout is held until it is: ${env.appUrl}/provider/jobs/${job.id}`,
    sms: `Report still needed for job ${job.reference} — payout is on hold until it's uploaded.`,
  }),

  payout_sent: ({ payout, job }) => ({
    subject: `Payment sent — ${money(payout.amountCents)}`,
    email: [
      `We've sent your payment for job ${job.reference}.`,
      ``,
      `Amount: ${money(payout.amountCents)}`,
      ``,
      `Depending on your bank it should land within 1-2 business days.`,
    ].join('\n'),
    sms: `Payment of ${money(payout.amountCents)} sent for job ${job.reference}.`,
  }),
};

async function sendEmail(to, subject, body) {
  if (env.emailDriver === 'log') {
    console.log(`[email:log] to=${to} subject="${subject}"`);
    return;
  }
  await getMailTransport().sendMail({ from: env.emailFrom, to, subject, text: body });
}

async function sendSms(to, body) {
  if (env.smsDriver === 'log') {
    console.log(`[sms:log] to=${to} body="${body.slice(0, 80)}"`);
    return;
  }
  const client = await getTwilioClient();
  await client.messages.create({ from: env.twilioFromNumber, to, body });
}

/**
 * Queue and attempt one notification. Never throws: a failed text message must
 * not roll back a completed booking. Failures are recorded and surface in the
 * admin exceptions view.
 */
async function dispatch({ userId, channel, template, recipient, subject, body }) {
  if (!recipient) return null;

  const row = await prisma.notification.create({
    data: { userId, channel, template, recipient, subject, body, status: 'QUEUED' },
  });

  try {
    if (channel === 'EMAIL') await sendEmail(recipient, subject || '', body);
    else await sendSms(recipient, body);

    return await prisma.notification.update({
      where: { id: row.id },
      data: { status: 'SENT', sentAt: new Date() },
    });
  } catch (err) {
    console.error(`[notify] ${channel} ${template} to ${recipient} failed:`, err.message);
    return prisma.notification.update({
      where: { id: row.id },
      data: { status: 'FAILED', error: String(err.message).slice(0, 500) },
    });
  }
}

/**
 * Send one templated notification to one user over both channels we have
 * contact details for.
 *
 * @param {string} templateName key of `templates`
 * @param {{id?:string,email?:string,phone?:string|null}} user
 * @param {object} data template variables
 */
export async function notifyUser(templateName, user, data = {}) {
  const build = templates[templateName];
  if (!build) throw new Error(`Unknown notification template: ${templateName}`);

  const { subject, email, sms } = build(data);
  const results = [];

  if (user.email) {
    results.push(
      await dispatch({
        userId: user.id,
        channel: 'EMAIL',
        template: templateName,
        recipient: user.email,
        subject,
        body: email,
      }),
    );
  }
  if (user.phone && sms) {
    results.push(
      await dispatch({
        userId: user.id,
        channel: 'SMS',
        template: templateName,
        recipient: user.phone,
        subject: null,
        body: sms,
      }),
    );
  }
  return results.filter(Boolean);
}

/** Fan a template out to many users (e.g. "new job on the board"). */
export async function notifyMany(templateName, users, data = {}) {
  const out = [];
  for (const u of users) out.push(...(await notifyUser(templateName, u, data)));
  return out;
}
