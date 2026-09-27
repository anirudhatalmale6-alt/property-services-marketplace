import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { env, isProd } from './env.js';
import { prisma } from './db.js';
import { errorHandler, notFoundHandler } from './lib/http.js';
import { authRouter } from './routes/auth.js';
import { catalogRouter } from './routes/catalog.js';
import { bookingRouter } from './routes/bookings.js';
import { providerRouter } from './routes/provider.js';
import { adminRouter } from './routes/admin.js';
import { documentRouter } from './routes/documents.js';
import { webhookRouter } from './routes/webhooks.js';

export function createApp() {
  const app = express();

  // Behind a load balancer / reverse proxy in production, so req.ip and the
  // Secure cookie logic see the real client rather than the proxy.
  if (isProd) app.set('trust proxy', 1);

  app.disable('x-powered-by');
  app.use(
    helmet({
      // The API serves JSON and document downloads, not HTML pages, so the
      // default CSP would only get in the way of the separate frontend.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );

  app.use(
    cors({
      origin: [env.appUrl],
      credentials: true, // httpOnly session cookies
    }),
  );

  app.use(cookieParser());
  if (!isProd) app.use(morgan('dev'));

  /**
   * Stripe webhooks need the raw body for signature verification, so this must
   * be mounted BEFORE express.json() — a parsed body can no longer be verified.
   */
  app.use('/api/webhooks', express.raw({ type: 'application/json' }), webhookRouter);

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));

  // Broad backstop; the credential routes have their own tighter limiter.
  app.use(
    '/api',
    rateLimit({
      windowMs: 60_000,
      limit: 300,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: { error: { message: 'Slow down a moment and try again', code: 'RATE_LIMITED' } },
    }),
  );

  app.get('/api/health', async (req, res) => {
    // A health check that does not touch the database is not a health check.
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({
        ok: true,
        env: env.nodeEnv,
        drivers: {
          payments: env.paymentsDriver,
          email: env.emailDriver,
          sms: env.smsDriver,
          storage: env.storageDriver,
        },
      });
    } catch (err) {
      res.status(503).json({ ok: false, error: 'database unavailable', detail: err.message });
    }
  });

  app.use('/api/auth', authRouter);
  app.use('/api/catalog', catalogRouter);
  app.use('/api/bookings', bookingRouter);
  app.use('/api/provider', providerRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/documents', documentRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
