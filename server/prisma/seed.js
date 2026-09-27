/**
 * Seed: enough real data to click the whole platform end to end.
 *
 * US home inspection marketplace. Creates an admin, two customers, three
 * inspectors at different onboarding stages, a catalogue with square-footage
 * pricing tiers and add-ons, service areas across three states, and a spread of
 * jobs across the lifecycle.
 *
 * Idempotent — safe to re-run. Refuses to touch a production database unless
 * SEED_ALLOW_PROD=true, because a seed that overwrites live accounts is how you
 * lose a client's customer list.
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { env, isProd } from '../src/env.js';
import { SETTING_DEFAULT_PAYOUT_BP, quote } from '../src/services/pricing.js';

const prisma = new PrismaClient();

if (isProd && !env.seedAllowProd) {
  console.error(
    'Refusing to seed a production database. Set SEED_ALLOW_PROD=true if you really mean it.',
  );
  process.exit(1);
}

/**
 * The example split from the SOP (80/20). Stored as a SETTING, not baked into
 * any service — the business changes it from the admin screen.
 */
const DEMO_PAYOUT_BP = 8000;

const CATALOGUE = [
  {
    category: { name: 'Home Inspections', slug: 'home-inspections', sortOrder: 1 },
    services: [
      {
        name: 'Full Home Inspection',
        slug: 'full-home-inspection',
        shortDescription: 'Complete buyer’s inspection with a same-day written report.',
        description:
          'A licensed inspector walks the entire property: roof, structure, foundation, ' +
          'attic, crawlspace, electrical, plumbing, HVAC, and all major appliances. You ' +
          'receive a photographic report you can take to a lender or use in negotiation.',
        basePriceCents: 35_000,
        durationMinutes: 180,
        requiresReport: true,
        collectsSquareFeet: true,
        collectsYearBuilt: true,
        sortOrder: 1,
        // Square-footage bands: the standard way home inspections are priced.
        sqftTiers: [
          { label: 'Up to 1,500 sq ft', min: 0, max: 1499, add: 0 },
          { label: '1,500–1,999 sq ft', min: 1500, max: 1999, add: 5_000 },
          { label: '2,000–2,499 sq ft', min: 2000, max: 2499, add: 10_000 },
          { label: '2,500–2,999 sq ft', min: 2500, max: 2999, add: 15_000 },
          { label: '3,000–3,999 sq ft', min: 3000, max: 3999, add: 22_500 },
          { label: '4,000 sq ft and above', min: 4000, max: null, add: 32_500 },
        ],
        ageRules: [
          { label: 'Property over 40 years old', minAge: 40, add: 5_000 },
          { label: 'Property over 75 years old', minAge: 75, add: 10_000 },
        ],
        addOns: [
          { label: 'Pool & spa inspection', add: 12_500 },
          { label: 'Septic system inspection', add: 17_500 },
          { label: 'Detached garage / workshop', add: 7_500 },
          { label: 'Sprinkler system', add: 6_000 },
        ],
      },
      {
        name: 'New Construction Phase Inspection',
        slug: 'new-construction-inspection',
        shortDescription: 'Pre-drywall or final walkthrough inspection on a new build.',
        description:
          'Catch framing, electrical rough-in and plumbing issues while they are still ' +
          'cheap to fix, or verify the builder’s punch list before you close.',
        basePriceCents: 30_000,
        durationMinutes: 150,
        requiresReport: true,
        collectsSquareFeet: true,
        collectsYearBuilt: false,
        sortOrder: 2,
        sqftTiers: [
          { label: 'Up to 2,499 sq ft', min: 0, max: 2499, add: 0 },
          { label: '2,500–3,499 sq ft', min: 2500, max: 3499, add: 7_500 },
          { label: '3,500 sq ft and above', min: 3500, max: null, add: 15_000 },
        ],
        ageRules: [],
        addOns: [{ label: 'Thermal imaging scan', add: 15_000 }],
      },
      {
        name: 'Four-Point Inspection',
        slug: 'four-point-inspection',
        shortDescription: 'Roof, electrical, plumbing and HVAC — usually for insurance.',
        description:
          'The condition report most insurers ask for on an older home: roof covering, ' +
          'electrical panel and wiring, plumbing supply and drainage, and the HVAC system.',
        basePriceCents: 17_500,
        durationMinutes: 75,
        requiresReport: true,
        collectsSquareFeet: false,
        collectsYearBuilt: true,
        sortOrder: 3,
        sqftTiers: [],
        ageRules: [{ label: 'Property over 50 years old', minAge: 50, add: 3_500 }],
        addOns: [],
      },
    ],
  },
  {
    category: { name: 'Specialty Inspections', slug: 'specialty', sortOrder: 2 },
    services: [
      {
        name: 'Termite / WDI Inspection',
        slug: 'termite-wdi-inspection',
        shortDescription: 'Wood-destroying insect report, signed and lender-ready.',
        description:
          'Inspection for termites, carpenter ants and wood-destroying organisms across ' +
          'the structure and its immediate surrounds, with the signed form lenders require.',
        basePriceCents: 12_500,
        durationMinutes: 60,
        requiresReport: true,
        collectsSquareFeet: false,
        collectsYearBuilt: false,
        sortOrder: 1,
        sqftTiers: [],
        ageRules: [],
        addOns: [],
      },
      {
        name: 'Roof Certification',
        slug: 'roof-certification',
        shortDescription: 'Roof condition assessment with remaining-life estimate.',
        description:
          'Full roof inspection with photographs, a condition assessment and an estimate ' +
          'of remaining serviceable life — accepted by most insurers and lenders.',
        basePriceCents: 15_000,
        durationMinutes: 60,
        requiresReport: true,
        collectsSquareFeet: false,
        collectsYearBuilt: true,
        sortOrder: 2,
        sqftTiers: [],
        ageRules: [{ label: 'Roof on a property over 20 years old', minAge: 20, add: 2_500 }],
        addOns: [{ label: 'Drone photography', add: 7_500 }],
      },
    ],
  },
];

/** Three states, so "nationwide-ready" is visible rather than asserted. */
const AREAS = [
  { name: 'Dallas — North', zip: '75201', city: 'Dallas', state: 'TX' },
  { name: 'Dallas — Plano', zip: '75024', city: 'Plano', state: 'TX' },
  { name: 'Fort Worth', zip: '76102', city: 'Fort Worth', state: 'TX' },
  { name: 'Austin — Central', zip: '78701', city: 'Austin', state: 'TX' },
  { name: 'Phoenix — Scottsdale', zip: '85251', city: 'Scottsdale', state: 'AZ' },
  { name: 'Atlanta — Buckhead', zip: '30305', city: 'Atlanta', state: 'GA' },
];

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
  return `HI-${out}`;
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

  // --------------------------------------------- global platform settings
  await prisma.setting.upsert({
    where: { key: SETTING_DEFAULT_PAYOUT_BP },
    create: { key: SETTING_DEFAULT_PAYOUT_BP, value: String(DEMO_PAYOUT_BP) },
    update: {},
  });
  await prisma.setting.upsert({
    where: { key: 'platform.name' },
    create: { key: 'platform.name', value: 'Home Inspection Marketplace' },
    update: {},
  });
  console.log(`  platform split: inspector ${DEMO_PAYOUT_BP / 100}% (a setting, not code)`);

  // ---------------------------------------------------------- catalogue
  const serviceBySlug = {};
  for (const block of CATALOGUE) {
    const category = await prisma.serviceCategory.upsert({
      where: { slug: block.category.slug },
      create: block.category,
      update: { name: block.category.name, sortOrder: block.category.sortOrder },
    });

    for (const s of block.services) {
      const { sqftTiers, ageRules, addOns, ...fields } = s;

      const service = await prisma.service.upsert({
        where: { slug: s.slug },
        create: { ...fields, categoryId: category.id, payoutMode: 'PERCENT' },
        update: { ...fields, categoryId: category.id },
      });
      serviceBySlug[s.slug] = service;

      // Rules are replaced wholesale, but only when this service has none —
      // re-running must not wipe rules an admin has since edited.
      const existingRules = await prisma.servicePriceRule.count({
        where: { serviceId: service.id },
      });
      if (existingRules === 0) {
        let order = 0;
        for (const t of sqftTiers) {
          await prisma.servicePriceRule.create({
            data: {
              serviceId: service.id,
              kind: 'SQFT_TIER',
              label: t.label,
              minValue: t.min,
              maxValue: t.max,
              amountCents: t.add,
              sortOrder: (order += 1),
            },
          });
        }
        for (const a of ageRules) {
          await prisma.servicePriceRule.create({
            data: {
              serviceId: service.id,
              kind: 'AGE_OVER',
              label: a.label,
              minValue: a.minAge,
              amountCents: a.add,
              sortOrder: (order += 1),
            },
          });
        }
        for (const a of addOns) {
          await prisma.servicePriceRule.create({
            data: {
              serviceId: service.id,
              kind: 'ADD_ON',
              label: a.label,
              amountCents: a.add,
              sortOrder: (order += 1),
            },
          });
        }
      }
    }
  }
  console.log(`  services: ${Object.keys(serviceBySlug).length} (with pricing rules)`);

  // ------------------------------------------------------- service areas
  const areaByZip = {};
  for (const a of AREAS) {
    const area = await prisma.serviceArea.upsert({
      where: { zip_country: { zip: a.zip, country: 'US' } },
      create: a,
      update: { name: a.name, city: a.city, state: a.state, isActive: true },
    });
    areaByZip[a.zip] = area;
  }
  console.log(`  service areas: ${AREAS.length} across 3 states`);

  // ---------------------------------------------------------------- admin
  const admin = await upsertUser({
    email: 'admin@example.com',
    fullName: 'Platform Admin',
    phone: '+12145550101',
    role: 'ADMIN',
    password,
  });

  // ------------------------------------------------------------ customers
  const customer1 = await upsertUser({
    email: 'customer@example.com',
    fullName: 'Rachel Alvarez',
    phone: '+12145550102',
    role: 'CUSTOMER',
    password,
  });
  const customer2 = await upsertUser({
    email: 'customer2@example.com',
    fullName: 'Tom Fielding',
    phone: '+12145550103',
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

  const addr1 =
    (await prisma.address.findFirst({ where: { userId: customer1.id } })) ??
    (await prisma.address.create({
      data: {
        userId: customer1.id,
        label: 'Home',
        line1: '4218 Wycliff Avenue',
        city: 'Dallas',
        state: 'TX',
        zip: '75201',
        notes: 'Lockbox on the side gate, code 4417. Friendly dog in the yard.',
      },
    }));

  const addr2 =
    (await prisma.address.findFirst({ where: { userId: customer2.id } })) ??
    (await prisma.address.create({
      data: {
        userId: customer2.id,
        label: 'Investment property',
        line1: '1120 Legacy Drive, Unit 4',
        city: 'Plano',
        state: 'TX',
        zip: '75024',
        notes: 'Tenant works nights — please do not arrive before 10am.',
      },
    }));

  // ------------------------------------------------------------ inspectors
  const inspectorSpecs = [
    {
      email: 'provider@example.com',
      fullName: 'Dave Marsh',
      phone: '+12145550110',
      businessName: 'Marsh Home Inspections',
      legalName: 'Marsh Inspection Services LLC',
      bio: '22 years in residential construction, TREC licensed inspector since 2011.',
      status: 'APPROVED',
      services: ['full-home-inspection', 'new-construction-inspection', 'four-point-inspection'],
      areas: ['75201', '75024', '76102'],
      credentials: [
        { kind: 'LICENSE', jurisdiction: 'TX', number: 'TREC-21847', issuedBy: 'Texas Real Estate Commission', expiresIn: 400 },
        { kind: 'INSURANCE', jurisdiction: null, number: 'GL-88213-04', issuedBy: 'Travelers', expiresIn: 300 },
      ],
    },
    {
      email: 'provider2@example.com',
      fullName: 'Priya Shah',
      phone: '+12145550111',
      businessName: 'Clearview Property Inspections',
      legalName: 'Clearview Inspections Inc.',
      bio: 'Termite, roof and four-point specialists across the DFW metroplex.',
      status: 'APPROVED',
      services: ['termite-wdi-inspection', 'roof-certification', 'four-point-inspection'],
      areas: ['75024', '76102', '78701'],
      credentials: [
        { kind: 'LICENSE', jurisdiction: 'TX', number: 'TREC-30912', issuedBy: 'Texas Real Estate Commission', expiresIn: 250 },
        { kind: 'CERTIFICATION', jurisdiction: 'TX', number: 'SPCS-1142', issuedBy: 'Texas Structural Pest Control Service', expiresIn: 180 },
        { kind: 'INSURANCE', jurisdiction: null, number: 'GL-44119-02', issuedBy: 'The Hartford', expiresIn: 45 },
      ],
    },
    {
      // Sits in the admin review queue so approval can be demonstrated.
      email: 'provider3@example.com',
      fullName: 'Sam Okafor',
      phone: '+16025550112',
      businessName: 'Okafor Inspection Group',
      legalName: 'Okafor Inspection Group LLC',
      bio: 'Full home and new construction inspections across the Phoenix valley.',
      status: 'PENDING',
      services: ['full-home-inspection'],
      areas: ['85251'],
      credentials: [
        { kind: 'LICENSE', jurisdiction: 'AZ', number: 'AZ-BTR-55218', issuedBy: 'Arizona Board of Technical Registration', expiresIn: 500 },
        { kind: 'INSURANCE', jurisdiction: null, number: 'GL-77320-01', issuedBy: 'Chubb', expiresIn: 350 },
      ],
    },
  ];

  const inspectors = {};
  for (const spec of inspectorSpecs) {
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
        legalName: spec.legalName,
        bio: spec.bio,
        status: spec.status,
        submittedAt: new Date(),
        reviewedAt: spec.status === 'APPROVED' ? new Date() : null,
        payoutRef: spec.status === 'APPROVED' ? `acct_demo_${user.id.slice(0, 8)}` : null,
      },
      update: {
        businessName: spec.businessName,
        legalName: spec.legalName,
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
      data: spec.areas.map((zip) => ({ providerId: profile.id, serviceAreaId: areaByZip[zip].id })),
    });

    // Onboarding documents + the credential records that reference them.
    if ((await prisma.document.count({ where: { providerId: profile.id } })) === 0) {
      const docByKind = {};
      for (const kind of ['IDENTITY', 'LICENSE', 'INSURANCE']) {
        docByKind[kind] = await prisma.document.create({
          data: {
            kind,
            providerId: profile.id,
            // No bytes on disk: the download route reports a retrieval failure
            // honestly rather than pretending the file is there.
            storageKey: `providers/${profile.id}/seed-${kind.toLowerCase()}.pdf`,
            fileName: `${kind.toLowerCase()}-${spec.businessName.split(' ')[0].toLowerCase()}.pdf`,
            mimeType: 'application/pdf',
            sizeBytes: 148_221,
            reviewState: spec.status === 'APPROVED' ? 'APPROVED' : 'PENDING',
            reviewedById: spec.status === 'APPROVED' ? admin.id : null,
            reviewedAt: spec.status === 'APPROVED' ? new Date() : null,
          },
        });
      }

      for (const c of spec.credentials) {
        await prisma.inspectorCredential.create({
          data: {
            providerId: profile.id,
            kind: c.kind,
            jurisdiction: c.jurisdiction,
            number: c.number,
            issuedBy: c.issuedBy,
            expiresAt: upcoming(c.expiresIn, 12),
            documentId: docByKind[c.kind === 'CERTIFICATION' ? 'LICENSE' : c.kind]?.id ?? null,
            reviewState: spec.status === 'APPROVED' ? 'APPROVED' : 'PENDING',
          },
        });
      }
    }

    inspectors[spec.email] = profile;
  }
  console.log(`  inspectors: ${inspectorSpecs.length} (with per-state credentials)`);

  // ---------------------------------------------------------------- jobs
  const marsh = inspectors['provider@example.com'];
  const clearview = inspectors['provider2@example.com'];

  const jobSpecs = [
    {
      // Live on the marketplace, unclaimed — this is what an inspector sees.
      slug: 'full-home-inspection',
      customer: customer1,
      address: addr1,
      start: upcoming(2, 9),
      status: 'OPEN',
      paid: true,
      squareFeet: 2450,
      yearBuilt: 1978,
      addOnLabels: ['Pool & spa inspection'],
      payerType: 'REALTOR',
      payerName: 'Keller Williams — Dallas Metro',
      notes: 'Contract is subject to inspection, closing in three weeks.',
    },
    {
      slug: 'termite-wdi-inspection',
      customer: customer2,
      address: addr2,
      start: upcoming(3, 13),
      status: 'OPEN',
      paid: true,
      notes: 'Neighbour has had termites — please check thoroughly.',
    },
    {
      // Assigned, so the customer tracker shows an inspector.
      slug: 'four-point-inspection',
      customer: customer2,
      address: addr2,
      start: upcoming(1, 10),
      status: 'ASSIGNED',
      provider: clearview,
      paid: true,
      yearBuilt: 1968,
      notes: 'Insurer needs this before renewal on the 14th.',
    },
    {
      // Parked awaiting the report — drives the exceptions queue.
      slug: 'roof-certification',
      customer: customer1,
      address: addr1,
      start: past(1, 8),
      status: 'AWAITING_REPORT',
      provider: clearview,
      paid: true,
      yearBuilt: 1978,
    },
    {
      // Finished and paid out: the inspector's earnings page has history.
      slug: 'full-home-inspection',
      customer: customer2,
      address: addr2,
      start: past(9, 9),
      status: 'COMPLETED',
      provider: marsh,
      paid: true,
      payout: 'PAID',
      squareFeet: 3100,
      yearBuilt: 2004,
    },
    {
      // Finished, payout still owing: admin has something to release.
      slug: 'new-construction-inspection',
      customer: customer1,
      address: addr1,
      start: past(4, 11),
      status: 'COMPLETED',
      provider: marsh,
      paid: true,
      payout: 'PENDING',
      squareFeet: 2700,
    },
  ];

  let created = 0;
  for (const spec of jobSpecs) {
    const reference = seededRef();
    if (await prisma.job.findUnique({ where: { reference } })) continue;

    const service = await prisma.service.findUnique({
      where: { slug: spec.slug },
      include: { priceRules: { where: { isActive: true } } },
    });

    // Resolve add-on labels to real rule ids, so the seeded jobs are priced by
    // the same engine a real booking uses.
    const addOnIds = (spec.addOnLabels ?? [])
      .map((label) => service.priceRules.find((r) => r.kind === 'ADD_ON' && r.label === label)?.id)
      .filter(Boolean);

    const priced = await quote({
      service,
      squareFeet: spec.squareFeet,
      yearBuilt: spec.yearBuilt,
      addOnIds,
    });

    const end = new Date(spec.start.getTime() + service.durationMinutes * 60_000);

    const job = await prisma.job.create({
      data: {
        reference,
        customerId: spec.customer.id,
        serviceId: service.id,
        addressId: spec.address.id,
        serviceAreaId: areaByZip[spec.address.zip].id,
        providerId: spec.provider?.id ?? null,
        status: spec.status,
        scheduledStart: spec.start,
        scheduledEnd: end,
        customerNotes: spec.notes || null,
        squareFeet: spec.squareFeet ?? null,
        yearBuilt: spec.yearBuilt ?? null,
        payerType: spec.payerType ?? 'CUSTOMER',
        payerName: spec.payerName ?? null,
        priceCents: priced.priceCents,
        providerPayCents: priced.providerPayCents,
        priceBreakdown: priced.breakdown,
        assignedAt: spec.provider ? new Date(spec.start.getTime() - 86_400_000) : null,
        startedAt: ['COMPLETED', 'AWAITING_REPORT'].includes(spec.status) ? spec.start : null,
        completedAt: spec.status === 'COMPLETED' ? end : null,
      },
    });

    // A plausible event trail, so the tracker is not empty.
    const trail = [{ toStatus: 'PENDING_PAYMENT', note: 'Booking created' }];
    if (spec.paid) trail.push({ toStatus: 'OPEN', note: 'Payment secured — released to inspectors' });
    if (spec.provider) trail.push({ toStatus: 'ASSIGNED', note: 'Accepted from Available Jobs' });
    if (['AWAITING_REPORT', 'COMPLETED'].includes(spec.status)) {
      trail.push({ toStatus: 'IN_PROGRESS', note: 'Inspector on site' });
    }
    if (spec.status === 'AWAITING_REPORT') {
      trail.push({ toStatus: 'AWAITING_REPORT', note: 'Marked done, report outstanding' });
    }
    if (spec.status === 'COMPLETED') trail.push({ toStatus: 'COMPLETED', note: 'Report submitted' });

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
          amountCents: priced.priceCents,
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
          amountCents: priced.providerPayCents,
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

  console.log('\nDemo accounts (password below applies to all):');
  console.log('  admin@example.com      — admin dashboard');
  console.log('  customer@example.com   — customer with bookings in flight');
  console.log('  provider@example.com   — approved inspector (TX, full home)');
  console.log('  provider2@example.com  — approved inspector (TX, specialty)');
  console.log('  provider3@example.com  — inspector awaiting approval (AZ)');
  console.log(`  password: ${password}`);
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
