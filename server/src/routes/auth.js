import crypto from 'node:crypto';
import express from 'express';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { asyncHandler, badRequest, conflict, parse, unauthorized } from '../lib/http.js';
import {
  clearAuthCookies,
  hashPassword,
  issueRefreshToken,
  readRefreshCookie,
  requireAuth,
  revokeRefreshToken,
  rotateRefreshToken,
  setAuthCookies,
  signAccessToken,
  verifyPassword,
} from '../lib/auth.js';

export const authRouter = express.Router();

/**
 * A real bcrypt hash at our working cost, of a value nobody can submit.
 * Compared against when the email is unknown so a failed login costs the same
 * time whether or not the account exists. Built once, lazily.
 */
let _decoy = null;
const decoyHash = () => {
  if (!_decoy) _decoy = bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 12);
  return _decoy;
};

// Brute-force guard on the credential endpoints specifically.
const authLimiter = rateLimit({
  windowMs: env.authRateLimitWindowMin * 60 * 1000,
  limit: env.authRateLimitMax,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { message: 'Too many attempts — please wait a few minutes', code: 'RATE_LIMITED' } },
});

const passwordRule = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(200)
  .refine((v) => /[a-z]/.test(v) && /[A-Z]/.test(v) && /[0-9]/.test(v), {
    message: 'Include an uppercase letter, a lowercase letter and a number',
  });

// E.164-ish. Stored as given if it already looks international.
const phoneRule = z
  .string()
  .trim()
  .regex(/^\+?[0-9 ()-]{6,20}$/, 'That does not look like a phone number')
  .transform((v) => v.replace(/[^\d+]/g, ''))
  .optional()
  .or(z.literal('').transform(() => undefined));

const registerSchema = z.object({
  fullName: z.string().trim().min(2, 'Please give your full name').max(120),
  email: z.string().trim().toLowerCase().email('That email does not look right'),
  phone: phoneRule,
  password: passwordRule,
  // Self-signup is limited to these two. An ADMIN is only ever made by the
  // seed or by another admin — never by an open endpoint.
  role: z.enum(['CUSTOMER', 'PROVIDER']).default('CUSTOMER'),
  businessName: z.string().trim().min(2).max(160).optional(),
});

const shapeUser = (user) => ({
  id: user.id,
  email: user.email,
  phone: user.phone,
  fullName: user.fullName,
  role: user.role,
  provider: user.provider
    ? {
        id: user.provider.id,
        businessName: user.provider.businessName,
        status: user.provider.status,
      }
    : null,
});

authRouter.post(
  '/register',
  authLimiter,
  asyncHandler(async (req, res) => {
    const body = parse(registerSchema, req.body);

    if (body.role === 'PROVIDER' && !body.businessName) {
      throw badRequest('Please tell us your business or trading name', [
        { field: 'businessName', message: 'Required for provider accounts' },
      ]);
    }
    // Providers are contacted about jobs by text, so a number is mandatory
    // for them but optional for customers.
    if (body.role === 'PROVIDER' && !body.phone) {
      throw badRequest('Please give a mobile number — we text you about available jobs', [
        { field: 'phone', message: 'Required for provider accounts' },
      ]);
    }

    const existing = await prisma.user.findUnique({ where: { email: body.email } });
    if (existing) throw conflict('An account with that email already exists', 'EMAIL_TAKEN');

    const passwordHash = await hashPassword(body.password);

    const user = await prisma.user.create({
      data: {
        email: body.email,
        phone: body.phone ?? null,
        fullName: body.fullName,
        passwordHash,
        role: body.role,
        ...(body.role === 'CUSTOMER'
          ? { customer: { create: {} } }
          : { provider: { create: { businessName: body.businessName, status: 'DRAFT' } } }),
      },
      include: { provider: true },
    });

    const accessToken = signAccessToken(user);
    const refresh = await issueRefreshToken(user.id);
    setAuthCookies(res, accessToken, refresh);

    res.status(201).json({ user: shapeUser(user), accessToken });
  }),
);

authRouter.post(
  '/login',
  authLimiter,
  asyncHandler(async (req, res) => {
    const { email, password } = parse(
      z.object({
        email: z.string().trim().toLowerCase().email('That email does not look right'),
        password: z.string().min(1, 'Please enter your password'),
      }),
      req.body,
    );

    const user = await prisma.user.findUnique({ where: { email }, include: { provider: true } });

    // Same message and a real hash comparison either way, so neither the
    // response content nor its timing reveals whether the address is
    // registered. The decoy must be a genuine bcrypt hash at the same cost, or
    // the compare returns early and the timing gap comes straight back.
    const ok = await verifyPassword(password, user ? user.passwordHash : decoyHash());

    if (!user || !ok) throw unauthorized('Email or password is incorrect');
    if (!user.isActive) throw unauthorized('This account has been disabled');

    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    const accessToken = signAccessToken(user);
    const refresh = await issueRefreshToken(user.id);
    setAuthCookies(res, accessToken, refresh);

    res.json({ user: shapeUser(user), accessToken });
  }),
);

authRouter.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const raw = readRefreshCookie(req) || req.body?.refreshToken;
    if (!raw) throw unauthorized('No session to refresh');

    const { user, refresh } = await rotateRefreshToken(raw);
    const full = await prisma.user.findUnique({ where: { id: user.id }, include: { provider: true } });

    const accessToken = signAccessToken(full);
    setAuthCookies(res, accessToken, refresh);

    res.json({ user: shapeUser(full), accessToken });
  }),
);

authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    await revokeRefreshToken(readRefreshCookie(req));
    clearAuthCookies(res);
    res.json({ ok: true });
  }),
);

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ user: shapeUser(req.user) });
  }),
);

authRouter.post(
  '/change-password',
  requireAuth,
  authLimiter,
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = parse(
      z.object({
        currentPassword: z.string().min(1, 'Enter your current password'),
        newPassword: passwordRule,
      }),
      req.body,
    );

    const ok = await verifyPassword(currentPassword, req.user.passwordHash);
    if (!ok) throw unauthorized('Your current password is incorrect');

    await prisma.user.update({
      where: { id: req.user.id },
      data: { passwordHash: await hashPassword(newPassword) },
    });

    // Changing a password ends every other session.
    await prisma.refreshToken.updateMany({
      where: { userId: req.user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    clearAuthCookies(res);

    res.json({ ok: true, message: 'Password changed — please sign in again' });
  }),
);
