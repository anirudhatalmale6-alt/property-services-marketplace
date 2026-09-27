/**
 * Concurrency proof for job acceptance.
 *
 * "Real-time job acceptance" is only correct if a burst of simultaneous taps
 * produces exactly one winner. A sequential test cannot show that — it never
 * puts two transactions in flight at once. This one fires N accepts at the same
 * job in the same tick, repeatedly, and asserts:
 *
 *   * exactly one HTTP 200, every other response a 409
 *   * exactly one providerId on the row afterwards
 *   * exactly one ASSIGNED event in the audit trail (no double logging)
 *   * the winning provider is the one named on the row
 *
 * Run with the API up:  node test/race.mjs
 *
 * Creates its own providers and jobs, and deletes only those.
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const API = process.env.API_URL || 'http://localhost:4000';
const RACERS = Number(process.env.RACERS || 8);
const ROUNDS = Number(process.env.ROUNDS || 5);
const PASSWORD = 'RaceTest123!';
const TAG = 'racetest';

const prisma = new PrismaClient();
let failures = 0;

const ok = (m) => console.log(`  \x1b[32mPASS\x1b[0m ${m}`);
const bad = (m) => {
  console.log(`  \x1b[31mFAIL\x1b[0m ${m}`);
  failures += 1;
};
const check = (cond, m) => (cond ? ok(m) : bad(m));

async function login(email) {
  const res = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`login ${email} failed: ${JSON.stringify(body)}`);
  // Use the bearer token rather than the cookie jar — simpler to fan out.
  return body.accessToken;
}

async function setup() {
  // A service + area that the racers will all share.
  const service = await prisma.service.findFirst({
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
  });
  const area = await prisma.serviceArea.findFirst({ where: { isActive: true } });
  if (!service || !area) throw new Error('Seed the database first (npm run seed)');

  const passwordHash = await bcrypt.hash(PASSWORD, 12);
  const racers = [];

  for (let i = 0; i < RACERS; i += 1) {
    const email = `${TAG}-provider-${i}@example.invalid`;

    const user = await prisma.user.upsert({
      where: { email },
      create: { email, fullName: `Race Tester ${i}`, phone: `+1214555${String(i).padStart(4, '0')}`, role: 'PROVIDER', passwordHash },
      update: { passwordHash, isActive: true },
    });

    const profile = await prisma.providerProfile.upsert({
      where: { userId: user.id },
      create: { userId: user.id, businessName: `${TAG} Racer ${i}`, status: 'APPROVED', reviewedAt: new Date() },
      update: { status: 'APPROVED' },
    });

    await prisma.providerService.upsert({
      where: { providerId_serviceId: { providerId: profile.id, serviceId: service.id } },
      create: { providerId: profile.id, serviceId: service.id },
      update: {},
    });
    await prisma.providerServiceArea.upsert({
      where: { providerId_serviceAreaId: { providerId: profile.id, serviceAreaId: area.id } },
      create: { providerId: profile.id, serviceAreaId: area.id },
      update: {},
    });

    racers.push({ email, userId: user.id, providerId: profile.id, token: await login(email) });
  }

  // A customer to own the jobs.
  const custEmail = `${TAG}-customer@example.invalid`;
  const customer = await prisma.user.upsert({
    where: { email: custEmail },
    create: { email: custEmail, fullName: 'Race Customer', role: 'CUSTOMER', passwordHash, customer: { create: {} } },
    update: { passwordHash, isActive: true },
  });

  const address = (await prisma.address.findFirst({ where: { userId: customer.id } }))
    ?? (await prisma.address.create({
      data: {
        userId: customer.id,
        line1: '1 Race Street',
        city: area.city,
        state: area.state,
        zip: area.zip,
      },
    }));

  return { service, area, racers, customer, address };
}

/** A job already OPEN on the board, created straight through Prisma. */
async function makeOpenJob({ service, area, customer, address }, round) {
  const start = new Date();
  start.setDate(start.getDate() + 5 + round);
  start.setHours(9, 0, 0, 0);

  return prisma.job.create({
    data: {
      reference: `PS-RACE${String(round).padStart(2, '0')}`,
      customerId: customer.id,
      serviceId: service.id,
      addressId: address.id,
      serviceAreaId: area.id,
      status: 'OPEN',
      scheduledStart: start,
      scheduledEnd: new Date(start.getTime() + service.durationMinutes * 60_000),
      priceCents: service.basePriceCents,
      // The race test is about assignment, not pricing — a flat payout keeps
      // it independent of whatever split is configured.
      providerPayCents: Math.round(service.basePriceCents * 0.8),
      events: { create: { toStatus: 'OPEN', note: 'Race fixture' } },
    },
  });
}

async function runRound(ctx, round) {
  const job = await makeOpenJob(ctx, round);

  // Fire them all in the same tick. Promise.all on already-started fetches
  // means the requests genuinely overlap on the server.
  const responses = await Promise.all(
    ctx.racers.map((r) =>
      fetch(`${API}/api/provider/jobs/${job.id}/accept`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${r.token}` },
      })
        .then(async (res) => ({ providerId: r.providerId, status: res.status, body: await res.json() }))
        .catch((err) => ({ providerId: r.providerId, status: 0, body: { error: String(err) } })),
    ),
  );

  const winners = responses.filter((r) => r.status === 200);
  const conflicts = responses.filter((r) => r.status === 409);
  const others = responses.filter((r) => r.status !== 200 && r.status !== 409);

  const row = await prisma.job.findUnique({
    where: { id: job.id },
    select: { status: true, providerId: true },
  });
  const assignedEvents = await prisma.jobEvent.count({
    where: { jobId: job.id, toStatus: 'ASSIGNED' },
  });

  const label = `round ${round + 1}: ${RACERS} simultaneous accepts`;

  if (winners.length === 1) ok(`${label} — exactly 1 winner`);
  else bad(`${label} — ${winners.length} winners (expected 1)`);

  if (conflicts.length === RACERS - 1) {
    ok(`${label} — other ${conflicts.length} got 409`);
  } else {
    bad(`${label} — ${conflicts.length} conflicts, expected ${RACERS - 1}`);
    for (const o of others) console.log(`      unexpected ${o.status}: ${JSON.stringify(o.body).slice(0, 160)}`);
  }

  check(row.status === 'ASSIGNED', `${label} — row is ASSIGNED`);
  check(row.providerId !== null, `${label} — row has a provider`);
  check(assignedEvents === 1, `${label} — exactly 1 ASSIGNED event logged (got ${assignedEvents})`);

  if (winners.length === 1) {
    check(
      row.providerId === winners[0].providerId,
      `${label} — the row names the provider that got the 200`,
    );
  }

  return job.id;
}

async function cleanup(createdJobIds) {
  // Only what this script made.
  await prisma.jobEvent.deleteMany({ where: { jobId: { in: createdJobIds } } });
  await prisma.job.deleteMany({ where: { id: { in: createdJobIds } } });

  const users = await prisma.user.findMany({
    where: { email: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);

  // Addresses and profiles cascade from the user; jobs are already gone.
  await prisma.address.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

async function main() {
  console.log(`\nJob-acceptance race: ${RACERS} providers x ${ROUNDS} rounds against ${API}\n`);

  const ctx = await setup();
  const created = [];

  try {
    for (let round = 0; round < ROUNDS; round += 1) {
      created.push(await runRound(ctx, round));
    }
  } finally {
    await cleanup(created);
    console.log('\n  (test providers, customer and jobs removed)');
  }

  console.log('');
  if (failures === 0) console.log('\x1b[32mNo double-assignment under concurrency.\x1b[0m\n');
  else console.log(`\x1b[31m${failures} check(s) FAILED\x1b[0m\n`);

  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error('Race test crashed:', err);
  await prisma.$disconnect();
  process.exit(1);
});
