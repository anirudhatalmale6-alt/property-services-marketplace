/**
 * Socket.IO layer — how the job board updates without the provider refreshing,
 * and how a customer's tracker moves on its own.
 *
 * Rooms:
 *   provider:<providerProfileId>  personal (job taken from under you, payouts)
 *   area:<serviceAreaId>          the job board for one market
 *   job:<jobId>                   everyone entitled to watch one job
 *   admin                         every admin, for the live dashboard
 *
 * Authentication is the same JWT as the REST API, so an unauthenticated socket
 * cannot subscribe to anything. Area rooms are only joined for areas the
 * provider actually covers — the socket layer is not a way around the
 * eligibility rules.
 */
import { Server } from 'socket.io';
import { prisma } from './db.js';
import { env } from './env.js';
import { verifyAccessToken } from './lib/auth.js';

let io = null;

export function initRealtime(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: [env.appUrl], credentials: true },
    path: '/socket.io',
  });

  io.use(async (socket, next) => {
    try {
      // Token may arrive in the handshake auth payload (browser) or as a
      // cookie (same-site deploys).
      const fromAuth = socket.handshake.auth?.token;
      const cookie = socket.handshake.headers?.cookie || '';
      const fromCookie = /(?:^|;\s*)ps_access=([^;]+)/.exec(cookie)?.[1];

      const payload = verifyAccessToken(fromAuth || (fromCookie && decodeURIComponent(fromCookie)));
      if (!payload) return next(new Error('unauthorized'));

      const user = await prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, role: true, isActive: true, provider: { select: { id: true, status: true } } },
      });
      if (!user?.isActive) return next(new Error('unauthorized'));

      socket.data.user = user;
      return next();
    } catch {
      return next(new Error('unauthorized'));
    }
  });

  io.on('connection', async (socket) => {
    const user = socket.data.user;

    if (user.role === 'ADMIN') socket.join('admin');

    if (user.role === 'PROVIDER' && user.provider) {
      socket.join(`provider:${user.provider.id}`);

      // Only approved providers get the live board.
      if (user.provider.status === 'APPROVED') {
        const areas = await prisma.providerServiceArea.findMany({
          where: { providerId: user.provider.id },
          select: { serviceAreaId: true },
        });
        for (const a of areas) socket.join(`area:${a.serviceAreaId}`);
      }
    }

    // A client asks to watch one job; we verify entitlement before joining.
    socket.on('job:watch', async (jobId, ack) => {
      try {
        if (typeof jobId !== 'string') return ack?.({ ok: false });
        const job = await prisma.job.findUnique({
          where: { id: jobId },
          select: { id: true, customerId: true, providerId: true },
        });
        if (!job) return ack?.({ ok: false });

        const entitled =
          user.role === 'ADMIN' ||
          job.customerId === user.id ||
          (user.provider && job.providerId === user.provider.id);

        if (!entitled) return ack?.({ ok: false });
        socket.join(`job:${jobId}`);
        return ack?.({ ok: true });
      } catch {
        return ack?.({ ok: false });
      }
    });

    socket.on('job:unwatch', (jobId) => {
      if (typeof jobId === 'string') socket.leave(`job:${jobId}`);
    });
  });

  return io;
}

const emit = (room, event, payload) => {
  if (io) io.to(room).emit(event, payload);
};

/** A paid job has landed on the board. */
export const emitJobOpened = (job) => {
  if (job.serviceAreaId) emit(`area:${job.serviceAreaId}`, 'job:opened', job);
  emit('admin', 'job:opened', job);
};

/** Someone claimed it — every other provider's board should drop it now. */
export const emitJobTaken = (job) => {
  if (job.serviceAreaId) emit(`area:${job.serviceAreaId}`, 'job:taken', { id: job.id });
  emit(`job:${job.id}`, 'job:updated', job);
  emit('admin', 'job:updated', job);
};

/** Any other status change. */
export const emitJobUpdated = (job) => {
  emit(`job:${job.id}`, 'job:updated', job);
  emit('admin', 'job:updated', job);
  if (job.providerId) emit(`provider:${job.providerId}`, 'job:updated', job);
};

export const emitJobReleased = (job) => {
  if (job.serviceAreaId) emit(`area:${job.serviceAreaId}`, 'job:opened', job);
  emit(`job:${job.id}`, 'job:updated', job);
  emit('admin', 'job:updated', job);
};

export const emitProviderUpdated = (provider) => {
  emit(`provider:${provider.id}`, 'provider:updated', provider);
  emit('admin', 'provider:updated', provider);
};

export const emitException = (exception) => emit('admin', 'exception:raised', exception);

export const getIo = () => io;
