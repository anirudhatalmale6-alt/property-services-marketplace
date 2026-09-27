import { PrismaClient } from '@prisma/client';
import { isProd } from './env.js';

export const prisma = new PrismaClient({
  log: isProd ? ['warn', 'error'] : ['warn', 'error'],
});

export async function disconnect() {
  await prisma.$disconnect();
}
