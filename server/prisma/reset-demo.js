/**
 * Clear all demo data so `npm run seed` can rebuild it from scratch.
 *
 * Deliberately NOT `prisma migrate reset`: that drops and recreates the schema,
 * which destroys the migration history along with the data. This only empties
 * the tables, in foreign-key order.
 *
 * Refuses to run against production unless SEED_ALLOW_PROD=true. Use this on a
 * development database only — it deletes every customer, inspector and job.
 */
import { PrismaClient } from '@prisma/client';
import { env, isProd } from '../src/env.js';

const prisma = new PrismaClient();

if (isProd && !env.seedAllowProd) {
  console.error('Refusing to wipe a production database.');
  process.exit(1);
}

// Children before parents.
const ORDER = [
  'jobEvent',
  'jobException',
  'document',
  'payout',
  'payment',
  'job',
  'inspectorCredential',
  'providerService',
  'providerServiceArea',
  'servicePriceRule',
  'address',
  'notification',
  'refreshToken',
  'providerProfile',
  'customerProfile',
  'user',
  'service',
  'serviceCategory',
  'serviceArea',
  'webhookEvent',
  'setting',
];

async function main() {
  console.log(`Clearing demo data from ${env.nodeEnv} database…`);
  let total = 0;
  for (const model of ORDER) {
    const { count } = await prisma[model].deleteMany({});
    if (count) console.log(`  ${model}: ${count}`);
    total += count;
  }
  console.log(`Done — ${total} rows removed. Run \`npm run seed\` to rebuild.`);
}

main()
  .catch((err) => {
    console.error('Reset failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
