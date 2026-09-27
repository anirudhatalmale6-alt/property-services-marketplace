import http from 'node:http';
import { createApp } from './app.js';
import { initRealtime } from './realtime.js';
import { assertEnv, env } from './env.js';
import { prisma } from './db.js';

assertEnv();

const app = createApp();
const server = http.createServer(app);
initRealtime(server);

server.listen(env.port, () => {
  console.log(`[server] listening on :${env.port} (${env.nodeEnv})`);
  console.log(
    `[server] drivers — payments:${env.paymentsDriver} email:${env.emailDriver} sms:${env.smsDriver} storage:${env.storageDriver}`,
  );
  if (env.paymentsDriver === 'mock') {
    console.log('[server] NOTE: payments are simulated. Set PAYMENTS_DRIVER=stripe to take real cards.');
  }
});

const shutdown = async (signal) => {
  console.log(`[server] ${signal} received, closing`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  // Don't hang forever on a stuck connection.
  setTimeout(() => process.exit(1), 10_000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
