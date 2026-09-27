import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { forbidden, unauthorized } from './http.js';

const ACCESS_COOKIE = 'ps_access';
const REFRESH_COOKIE = 'ps_refresh';
const BCRYPT_ROUNDS = 12;

export const hashPassword = (plain) => bcrypt.hash(plain, BCRYPT_ROUNDS);
export const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash);

export function signAccessToken(user) {
  return jwt.sign({ sub: user.id, role: user.role, email: user.email }, env.jwtSecret, {
    expiresIn: env.accessTokenTtl,
  });
}

/**
 * Refresh tokens are random opaque strings; only their SHA-256 lands in the
 * database, so a dump of the table cannot be replayed as a session.
 */
export async function issueRefreshToken(userId) {
  const raw = crypto.randomBytes(48).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(raw).digest('hex');
  const expiresAt = new Date(Date.now() + env.refreshTokenTtlDays * 86_400_000);

  await prisma.refreshToken.create({ data: { userId, tokenHash, expiresAt } });
  return { raw, expiresAt };
}

export async function rotateRefreshToken(raw) {
  const tokenHash = crypto.createHash('sha256').update(raw).digest('hex');
  const existing = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!existing || existing.revokedAt || existing.expiresAt < new Date()) {
    throw unauthorized('Your session has expired, please sign in again');
  }
  if (!existing.user.isActive) throw forbidden('This account has been disabled');

  await prisma.refreshToken.update({
    where: { id: existing.id },
    data: { revokedAt: new Date() },
  });

  const next = await issueRefreshToken(existing.userId);
  return { user: existing.user, refresh: next };
}

export async function revokeRefreshToken(raw) {
  if (!raw) return;
  const tokenHash = crypto.createHash('sha256').update(raw).digest('hex');
  await prisma.refreshToken
    .update({ where: { tokenHash }, data: { revokedAt: new Date() } })
    .catch(() => {}); // already gone is a successful logout
}

export function setAuthCookies(res, accessToken, refresh) {
  const base = {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: env.cookieSecure ? 'none' : 'lax',
    path: '/',
  };
  res.cookie(ACCESS_COOKIE, accessToken, { ...base, maxAge: 60 * 60 * 1000 });
  res.cookie(REFRESH_COOKIE, refresh.raw, { ...base, expires: refresh.expiresAt });
}

export function clearAuthCookies(res) {
  const base = {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: env.cookieSecure ? 'none' : 'lax',
    path: '/',
  };
  res.clearCookie(ACCESS_COOKIE, base);
  res.clearCookie(REFRESH_COOKIE, base);
}

export const readRefreshCookie = (req) => req.cookies?.[REFRESH_COOKIE];

function readAccessToken(req) {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  return req.cookies?.[ACCESS_COOKIE];
}

/** Verify a token string; returns the payload or null. Shared with Socket.IO. */
export function verifyAccessToken(token) {
  if (!token) return null;
  try {
    return jwt.verify(token, env.jwtSecret);
  } catch {
    return null;
  }
}

/** Populate req.user, or 401. */
export const requireAuth = async (req, res, next) => {
  try {
    const payload = verifyAccessToken(readAccessToken(req));
    if (!payload) throw unauthorized();

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      include: { provider: true },
    });
    if (!user) throw unauthorized();
    if (!user.isActive) throw forbidden('This account has been disabled');

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
};

/** Gate by role. Use after requireAuth. */
export const requireRole =
  (...roles) =>
  (req, res, next) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) {
      return next(forbidden('Your account does not have access to this area'));
    }
    next();
  };

/**
 * A provider may browse and accept jobs only once an admin has approved them.
 * This is the onboarding/verification gate — it lives in one place so no route
 * can forget it.
 */
export const requireApprovedProvider = (req, res, next) => {
  if (req.user?.role !== 'PROVIDER') return next(forbidden('Providers only'));
  if (!req.user.provider) return next(forbidden('Finish setting up your provider profile first'));
  if (req.user.provider.status !== 'APPROVED') {
    return next(
      forbidden(
        req.user.provider.status === 'PENDING'
          ? 'Your application is still under review'
          : 'Your provider account is not approved for work',
      ),
    );
  }
  next();
};
