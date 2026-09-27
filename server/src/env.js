import 'dotenv/config';

const bool = (v, dflt = false) => {
  if (v === undefined || v === '') return dflt;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
};

const int = (v, dflt) => {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) ? n : dflt;
};

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: int(process.env.PORT, 4000),
  appUrl: process.env.APP_URL || 'http://localhost:5173',
  apiUrl: process.env.API_URL || 'http://localhost:4000',
  databaseUrl: process.env.DATABASE_URL,

  jwtSecret: process.env.JWT_SECRET,
  accessTokenTtl: process.env.ACCESS_TOKEN_TTL || '15m',
  refreshTokenTtlDays: int(process.env.REFRESH_TOKEN_TTL_DAYS, 30),
  cookieSecure: bool(process.env.COOKIE_SECURE, false),

  // Brute-force guard on the credential endpoints. Configurable because the
  // automated test suites legitimately sign in dozens of times in a minute;
  // the default is the production value and `assertEnv` refuses a slack one
  // in production, so raising it for a test run cannot leak into live.
  authRateLimitMax: int(process.env.AUTH_RATE_LIMIT_MAX, 20),
  authRateLimitWindowMin: int(process.env.AUTH_RATE_LIMIT_WINDOW_MIN, 15),

  currency: (process.env.CURRENCY || 'AUD').toUpperCase(),
  paymentsDriver: process.env.PAYMENTS_DRIVER || 'mock',
  stripeSecretKey: process.env.STRIPE_SECRET_KEY || '',
  stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',

  emailDriver: process.env.EMAIL_DRIVER || 'log',
  emailFrom: process.env.EMAIL_FROM || 'Property Services <no-reply@example.com>',
  smtpHost: process.env.SMTP_HOST || '',
  smtpPort: int(process.env.SMTP_PORT, 587),
  smtpUser: process.env.SMTP_USER || '',
  smtpPass: process.env.SMTP_PASS || '',

  smsDriver: process.env.SMS_DRIVER || 'log',
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID || '',
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN || '',
  twilioFromNumber: process.env.TWILIO_FROM_NUMBER || '',

  storageDriver: process.env.STORAGE_DRIVER || 'local',
  uploadDir: process.env.UPLOAD_DIR || './uploads',
  maxUploadMb: int(process.env.MAX_UPLOAD_MB, 15),
  s3Bucket: process.env.S3_BUCKET || '',
  s3Region: process.env.S3_REGION || '',
  s3AccessKeyId: process.env.S3_ACCESS_KEY_ID || '',
  s3SecretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
  s3Endpoint: process.env.S3_ENDPOINT || '',

  seedPassword: process.env.SEED_PASSWORD || 'DemoPass123!',
  seedAllowProd: bool(process.env.SEED_ALLOW_PROD, false),
};

export const isProd = env.nodeEnv === 'production';

// Fail at boot, not on the first request. A missing DATABASE_URL or a
// default JWT secret in production is a deployment mistake we want to be
// loud about.
export function assertEnv() {
  const problems = [];

  if (!env.databaseUrl) problems.push('DATABASE_URL is not set');
  if (!env.jwtSecret) problems.push('JWT_SECRET is not set');
  else if (env.jwtSecret.length < 32) {
    problems.push('JWT_SECRET must be at least 32 characters');
  }

  if (isProd) {
    if (/change-me|dev-only/i.test(env.jwtSecret || '')) {
      problems.push('JWT_SECRET is still the example value');
    }
    if (!env.cookieSecure) {
      problems.push('COOKIE_SECURE must be true in production');
    }
    // Refuse at boot, not at the first checkout. A deploy that fails to start
    // is a problem for us; a customer hitting a 500 halfway through paying is
    // a problem for the business.
    if (env.paymentsDriver !== 'stripe') {
      problems.push(
        `PAYMENTS_DRIVER=${env.paymentsDriver} cannot be used in production — set real Stripe keys`,
      );
    }
    if (env.paymentsDriver === 'stripe' && !env.stripeSecretKey) {
      problems.push('PAYMENTS_DRIVER=stripe but STRIPE_SECRET_KEY is empty');
    }
    if (env.paymentsDriver === 'stripe' && !env.stripeWebhookSecret) {
      problems.push('PAYMENTS_DRIVER=stripe but STRIPE_WEBHOOK_SECRET is empty');
    }
    if (env.emailDriver === 'smtp' && !env.smtpHost) {
      problems.push('EMAIL_DRIVER=smtp but SMTP_HOST is empty');
    }
    if (env.smsDriver === 'twilio' && !env.twilioAccountSid) {
      problems.push('SMS_DRIVER=twilio but TWILIO_ACCOUNT_SID is empty');
    }
    if (env.storageDriver === 's3' && !env.s3Bucket) {
      problems.push('STORAGE_DRIVER=s3 but S3_BUCKET is empty');
    }
    // A value raised for a test run must never reach production unnoticed.
    if (env.authRateLimitMax > 100) {
      problems.push(
        `AUTH_RATE_LIMIT_MAX=${env.authRateLimitMax} is too slack for production (max 100)`,
      );
    }
  }

  if (env.authRateLimitMax < 1 || env.authRateLimitWindowMin < 1) {
    problems.push('AUTH_RATE_LIMIT_MAX and AUTH_RATE_LIMIT_WINDOW_MIN must be at least 1');
  }

  if (problems.length) {
    throw new Error(`Invalid configuration:\n  - ${problems.join('\n  - ')}`);
  }
}
