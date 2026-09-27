/**
 * Seed: enough real data to click the whole platform end to end.
 *
 * Creates an admin, two customers, three providers at different onboarding
 * stages, a catalogue, service areas, and a spread of jobs across the lifecycle
 * so the admin dashboard and the customer tracker both have something to show.
 *
 * Idempotent — safe to re-run. Refuses to touch a production database unless
 * SEED_ALLOW_PROD=true, because a seed that overwrites live accounts is how you
 * lose a client's customer list.
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { env, isProd } from '../src/env.js';

const prisma = new PrismaClient();

if (isProd && !env.seedAllowProd) {
  console.error(
    'Refusing to seed a production database. Set SEED_ALLOW_PROD=true if you really mean it.',
  );
  process.exit(1);
}

const CATALOGUE = [
  {
    category: { name: 'Inspections & Reports', slug: 'inspections', sortOrder: 1 },
    services: [
      {
        name: 'Pre-Purchase Building Inspection',
        slug: 'pre-purchase-building-inspection',
        shortDescription: 'Full structural inspection with a written report within 24 hours.',
        description:
          'A licensed inspector attends the property and assesses structure, roof, subfloor, ' +
          'wet areas, drainage and visible defects. You receive a photographic report you can ' +
          'take to a negotiation or a lender.',
        basePriceCents: 49_900,
        providerPayCents: 32_000,
        durationMinutes: 120,
        requiresReport: true,
        sortOrder: 1,
      },
      {
        name: 'Timber Pest Inspection',
        slug: 'timber-pest-inspection',
        shortDescription: 'Termite and timber pest check with a signed report.',
        description:
          'Inspection for termites, borers and fungal decay across the building and its ' +
          'immediate surrounds, including moisture readings and a written assessment.',
        basePriceCents: 34_900,
        providerPayCents: 22_000,
        durationMinutes: 90,
        requiresReport: true,
        sortOrder: 2,
      },
      {
        name: 'Smoke Alarm Compliance Check',
        slug: 'smoke-alarm-compliance-check',
        shortDescription: 'Legislation compliance check and certificate for rentals.',
        description:
          'Every alarm tested, batteries replaced where needed, placement checked against ' +
          'current legislation, and a compliance certificate issued for your records.',
        basePriceCents: 14_900,
        providerPayCents: 9_000,
        durationMinutes: 45,
        requiresReport: true,
        sortOrder: 3,
      },
    ],
  },
  {
    category: { name: 'Maintenance', slug: 'maintenance', sortOrder: 2 },
    services: [
      {
        name: 'Gutter Clean & Roof Check',
        slug: 'gutter-clean-roof-check',
        shortDescription: 'Gutters cleared, downpipes flushed, roof photographed.',
        description:
          'All accessible gutters cleared by hand and vacuum, downpipes flushed and tested, ' +
          'and a photo set of the roof condition so you can see what was done.',
        basePriceCents: 27_900,
        providerPayCents: 18_000,
        durationMinutes: 120,
        requiresReport: false,
        sortOrder: 1,
      },
      {
        name: 'End of Lease Clean',
        slug: 'end-of-lease-clean',
        shortDescription: 'Bond-back clean with a completion checklist.',
        description:
          'Full interior clean to letting-agent standard including oven, windows and wet ' +
          'areas, finished with a signed checklist and photos for your agent.',
        basePriceCents: 39_900,
        providerPayCents: 26_000,
        durationMinutes: 240,
        requiresReport: false,
        sortOrder: 2,
      },
    ],
  },
];

const AREAS = [
  { name: 'Brisbane CBD', postcode: '4000', city: 'Brisbane', region: 'QLD' },
  { name: 'Brisbane North', postcode: '4051', city: 'Brisbane', region: 'QLD' },
  { name: 'Brisbane South', postcode: '4103', city: 'Brisbane', region: 'QLD' },
  { name: 'Gold Coast Central', postcode: '4217', city: 'Gold Coast', region: 'QLD' },
  { name: 'Sydney Inner West', postcode: '2040', city: 'Sydney', region: 'NSW' },
  { name: 'Melbourne Inner North', postcode: '3056', city: 'Melbourne', region: 'VIC' },
];

/** Next weekday at a given hour, offset by whole days. */
function upcoming(daysAhead, hour) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  d.setHours(hour, 0, 0, 0);
  return d;
}

function past(daysBack, hour) {
  const d = new Date();
  d.setDate(d.getDate() - daysBack);
  d.setHours(hour, 0, 0, 0);
  return d;
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
let refCounter = 0;
const seededRef = () => {
  // Deterministic references so re-running the seed updates the same jobs
  // instead of piling up duplicates.
  refCounter += 1;
  const n = refCounter * 7919;
  let out = '';
  let x = n;
  for (let i = 0; i < 6; i += 1) {
    out += ALPHABET[x % ALPHABET.length];
    x = Math.floor(x / ALPHABET.length) + 13 * (i + 1);
  }
  return `PS-${out}`;
};

async function upsertUser({ email, fullName, phone, role, password }) {
  const passwordHash = await bcrypt.hash(password, 12);
  return prisma.user.upsert({
    where: { email },
    create: { email, fullName, phone, role, passwordHash },
    update: { fullName, phone, role, passwordHash, isActive: true },
  });
}

async function main() {
  const password = env.seedPassword;
  console.log('Seeding…');

  // ---------------------------------------------------------- catalogue
  const serviceBySlug = {};
  for (const block of CATALOGUE) {
    const category = await prisma.serviceCategory.upsert({
      where: { slug: block.category.slug },
      create: block.category,
      update: { name: block.category.name, sortOrder: block.category.sortOrder },
    });

    for (const s of block.services) {
      const service = await prisma.service.upsert({
        where: { slug: s.slug },
        create: { ...s, categoryId: category.id },
        update: { ...s, categoryId: category.id },
      });
      serviceBySlug[s.slug] = service;
    }
  }
  console.log(`  services: ${Object.keys(serviceBySlug).length}`);

  // -------------------------------------------------------- service areas
  const areaByPostcode = {};
  for (const a of AREAS) {
    const area = await prisma.serviceArea.upsert({
      where: { postcode_country: { postcode: a.postcode, country: 'AU' } },
      create: a,
      update: { name: a.name, city: a.city, region: a.region, isActive: true },
    });
    areaByPostcode[a.postcode] = area;
  }
  console.log(`  service areas: ${AREAS.length}`);

  // ---------------------------------------------------------------- admin
  const admin = await upsertUser({
    email: 'admin@example.com',
    fullName: 'Platform Admin',
    phone: '+61400000001',
    role: 'ADMIN',
    password,
  });

  // ------------------------------------------------------------ customers
  const customer1 = await upsertUser({
    email: 'customer@example.com',
    fullName: 'Rachel Nguyen',
    phone: '+61400000002',
    role: 'CUSTOMER',
    password,
  });
  const customer2 = await upsertUser({
    email: 'customer2@example.com',
    fullName: 'Tom Fielding',
    phone: '+61400000003',
    role: 'CUSTOMER',
    password,
  });

  for (const c of [customer1, customer2]) {
    await prisma.customerProfile.upsert({
      where: { userId: c.id },
      create: { userId: c.id },
      update: {},
    });
  }

  const addr1 = await prisma.address.findFirst({ where: { userId: customer1.id } })
    ?? (await prisma.address.create({
      data: {
        userId: customer1.id,
        label: 'Home',
        line1: '18 Ferndale Street',
        city: 'Brisbane',
        region: 'QLD',
        postcode: '4051',
        notes: 'Key in the lockbox by the side gate, code 4417. Small dog, friendly.',
      },
    }));

  const addr2 = await prisma.address.findFirst({ where: { userId: customer2.id } })
    ?? (await prisma.address.create({
      data: {
        userId: customer2.id,
        label: 'Investment property',
        line1: '4/92 Latrobe Terrace',
        city: 'Brisbane',
        region: 'QLD',
        postcode: '4103',
        notes: 'Tenant works nights — please do not arrive before 10am.',
      },
    }));

  // ------------------------------------------------------------ providers
  const providerSpecs = [
    {
      email: 'provider@example.com',
      fullName: 'Dave Marsh',
      phone: '+61400000010',
      businessName: 'Marsh Building Inspections',
      abnOrLicenceNo: 'QBCC 1174320',
      bio: '22 years in residential construction, licensed building inspector since 2011.',
      status: 'APPROVED',
      services: ['pre-purchase-building-inspection', 'timber-pest-inspection', 'smoke-alarm-compliance-check'],
      areas: ['4000', '4051', '4103'],
      docs: true,
    },
    {
      email: 'provider2@example.com',
      fullName: 'Priya Shah',
      phone: '+61400000011',
      businessName: 'Clearview Property Services',
      abnOrLicenceNo: 'ABN 41 622 118 903',
      bio: 'Gutter, roof and end-of-lease specialists covering greater Brisbane.',
      status: 'APPROVED',
      services: ['gutter-clean-roof-check', 'end-of-lease-clean', 'smoke-alarm-compliance-check'],
      areas: ['4051', '4103', '4217'],
      docs: true,
    },
    {
      // Sits in the admin review queue so approval can be demonstrated.
      email: 'provider3@example.com',
      fullName: 'Sam Okafor',
      phone: '+61400000012',
      businessName: 'Okafor Pest & Timber',
      abnOrLicenceNo: 'PMT 88213',
      bio: 'Timber pest inspections across the Gold Coast.',
      status: 'PENDING',
      services: ['timber-pest-inspection'],
      areas: ['4217'],
      docs: true,
    },
  ];

  const providers = {};
  for (const spec of providerSpecs) {
    const user = await upsertUser({
      email: spec.email,
      fullName: spec.fullName,
      phone: spec.phone,
      role: 'PROVIDER',
      password,
    });

    const profile = await prisma.providerProfile.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        businessName: spec.businessName,
        abnOrLicenceNo: spec.abnOrLicenceNo,
        bio: spec.bio,
        status: spec.status,
        submittedAt: new Date(),
        reviewedAt: spec.status === 'APPROVED' ? new Date() : null,
        payoutRef: spec.status === 'APPROVED' ? `acct_demo_${user.id.slice(0, 8)}` : null,
      },
      update: {
        businessName: spec.businessName,
        abnOrLicenceNo: spec.abnOrLicenceNo,
        bio: spec.bio,
        status: spec.status,
      },
    });

    await prisma.providerService.deleteMany({ where: { providerId: profile.id } });
    await prisma.providerService.createMany({
      data: spec.services.map((slug) => ({ providerId: profile.id, serviceId: serviceBySlug[slug].id })),
    });

    await prisma.providerServiceArea.deleteMany({ where: { providerId: profile.id } });
    await prisma.providerServiceArea.createMany({
      data: spec.areas.map((pc) => ({ providerId: profile.id, serviceAreaId: areaByPostcode[pc].id })),
    });

    // Onboarding document rows. No bytes on disk — the download route reports a
    // retrieval failure honestly rather than pretending the file is there.
    if (spec.docs) {
      const existing = await prisma.document.count({ where: { providerId: profile.id } });
      if (existing === 0) {
        for (const kind of ['IDENTITY', 'LICENCE', 'INSURANCE']) {
          await prisma.document.create({
            data: {
              kind,
              providerId: profile.id,
              storageKey: `providers/${profile.id}/seed-${kind.toLowerCase()}.pdf`,
              fileName: `${kind.toLowerCase()}-${spec.businessName.split(' ')[0].toLowerCase()}.pdf`,
              mimeType: 'application/pdf',
              sizeBytes: 148_221,
              reviewState: spec.status === 'APPROVED' ? 'APPROVED' : 'PENDING',
              reviewedById: spec.status === 'APPROVED' ? admin.id : null,
              reviewedAt: spec.status === 'APPROVED' ? new Date() : null,
              expiresAt: kind === 'INSURANCE' ? upcoming(300, 9) : null,
            },
          });
        }
      }
    }

    providers[spec.email] = profile;
  }
  console.log(`  providers: ${providerSpecs.length}`);

  // ---------------------------------------------------------------- jobs
  const marsh = providers['provider@example.com'];
  const clearview = providers['provider2@example.com'];

  const jobSpecs = [
    {
      // Live on the marketplace, unclaimed — this is what a provider sees.
      slug: 'pre-purchase-building-inspection',
      customer: customer1,
      address: addr1,
      start: upcoming(2, 9),
      status: 'OPEN',
      paid: true,
      notes: 'Contract is subject to inspection, settlement is in three weeks.',
    },
    {
      slug: 'timber-pest-inspection',
      customer: customer2,
      address: addr2,
      start: upcoming(3, 13),
      status: 'OPEN',
      paid: true,
      notes: 'Neighbour has had termites, want this checked properly.',
    },
    {
      // Assigned, so the customer tracker shows a provider.
      slug: 'smoke-alarm-compliance-check',
      customer: customer2,
      address: addr2,
      start: upcoming(1, 10),
      status: 'ASSIGNED',
      provider: clearview,
      paid: true,
      notes: 'Two-storey unit, four alarms.',
    },
    {
      // Parked awaiting the report — drives the exceptions queue.
      slug: 'gutter-clean-roof-check',
      customer: customer1,
      address: addr1,
      start: past(1, 8),
      status: 'AWAITING_REPORT',
      provider: clearview,
      paid: true,
      notes: '',
    },
    {
      // Finished and paid out: the provider's earnings page has history.
      slug: 'pre-purchase-building-inspection',
      customer: customer2,
      address: addr2,
      start: past(9, 9),
      status: 'COMPLETED',
      provider: marsh,
      paid: true,
      payout: 'PAID',
      notes: '',
    },
    {
      // Finished, payout still owing: admin has something to release.
      slug: 'timber-pest-inspection',
      customer: customer1,
      address: addr1,
      start: past(4, 11),
      status: 'COMPLETED',
      provider: marsh,
      paid: true,
      payout: 'PENDING',
      notes: '',
    },
  ];

  let created = 0;
  for (const spec of jobSpecs) {
    const service = serviceBySlug[spec.slug];
    const reference = seededRef();

    const existing = await prisma.job.findUnique({ where: { reference } });
    if (existing) continue;

    const end = new Date(spec.start.getTime() + service.durationMinutes * 60_000);

    const job = await prisma.job.create({
      data: {
        reference,
        customerId: spec.customer.id,
        serviceId: service.id,
        addressId: spec.address.id,
        serviceAreaId: areaByPostcode[spec.address.postcode].id,
        providerId: spec.provider?.id ?? null,
        status: spec.status,
        scheduledStart: spec.start,
        scheduledEnd: end,
        customerNotes: spec.notes || null,
        priceCents: service.basePriceCents,
        providerPayCents: service.providerPayCents,
        assignedAt: spec.provider ? new Date(spec.start.getTime() - 86_400_000) : null,
        startedAt: ['COMPLETED', 'AWAITING_REPORT'].includes(spec.status) ? spec.start : null,
        completedAt: spec.status === 'COMPLETED' ? end : null,
      },
    });

    // A plausible event trail, so the tracker is not empty.
    const trail = [{ toStatus: 'PENDING_PAYMENT', note: 'Booking created' }];
    if (spec.paid) trail.push({ toStatus: 'OPEN', note: 'Payment received — listed on the marketplace' });
    if (spec.provider) trail.push({ toStatus: 'ASSIGNED', note: 'Accepted from the job board' });
    if (['AWAITING_REPORT', 'COMPLETED'].includes(spec.status)) {
      trail.push({ toStatus: 'IN_PROGRESS', note: 'Provider on site' });
    }
    if (spec.status === 'AWAITING_REPORT') {
      trail.push({ toStatus: 'AWAITING_REPORT', note: 'Marked done, report outstanding' });
    }
    if (spec.status === 'COMPLETED') trail.push({ toStatus: 'COMPLETED', note: 'Report uploaded' });

    let prev = null;
    let stamp = new Date(job.createdAt);
    for (const step of trail) {
      await prisma.jobEvent.create({
        data: {
          jobId: job.id,
          fromStatus: prev,
          toStatus: step.toStatus,
          note: step.note,
          createdAt: stamp,
        },
      });
      prev = step.toStatus;
      stamp = new Date(stamp.getTime() + 3_600_000);
    }

    if (spec.paid) {
      await prisma.payment.create({
        data: {
          jobId: job.id,
          amountCents: service.basePriceCents,
          currency: env.currency,
          provider: 'mock',
          externalId: `pi_seed_${job.id.slice(0, 12)}`,
          status: 'SUCCEEDED',
          paidAt: job.createdAt,
        },
      });
    }

    if (spec.payout) {
      await prisma.payout.create({
        data: {
          jobId: job.id,
          providerId: spec.provider.id,
          amountCents: service.providerPayCents,
          currency: env.currency,
          status: spec.payout,
          externalId: spec.payout === 'PAID' ? `tr_seed_${job.id.slice(0, 12)}` : null,
          paidAt: spec.payout === 'PAID' ? end : null,
        },
      });
    }

    if (spec.status === 'COMPLETED') {
      await prisma.document.create({
        data: {
          kind: 'JOB_REPORT',
          jobId: job.id,
          providerId: spec.provider.id,
          storageKey: `jobs/${job.id}/seed-report.pdf`,
          fileName: `${reference}-report.pdf`,
          mimeType: 'application/pdf',
          sizeBytes: 402_118,
        },
      });
    }

    if (spec.status === 'AWAITING_REPORT') {
      await prisma.jobException.create({
        data: {
          jobId: job.id,
          kind: 'REPORT_MISSING',
          detail: `${reference} marked done but the required report is not uploaded`,
        },
      });
    }

    created += 1;
  }
  console.log(`  jobs: ${created} created (${jobSpecs.length - created} already present)`);

  await prisma.setting.upsert({
    where: { key: 'platform.name' },
    create: { key: 'platform.name', value: 'Property Services' },
    update: {},
  });

  console.log('\nDemo accounts (password below applies to all):');
  console.log(`  admin@example.com      — admin dashboard`);
  console.log(`  customer@example.com   — customer with bookings in flight`);
  console.log(`  provider@example.com   — approved provider (inspections)`);
  console.log(`  provider2@example.com  — approved provider (maintenance)`);
  console.log(`  provider3@example.com  — provider awaiting approval`);
  console.log(`  password: ${password}`);
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
