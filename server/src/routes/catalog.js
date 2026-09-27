/**
 * Public catalogue: what we do, where we do it, and when we're free.
 * No authentication — a customer has to be able to price a job before signing up.
 */
import express from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { asyncHandler, notFound, parse } from '../lib/http.js';
import { getAvailability } from '../services/slots.js';
import { env } from '../env.js';

export const catalogRouter = express.Router();

catalogRouter.get(
  '/services',
  asyncHandler(async (req, res) => {
    const categories = await prisma.serviceCategory.findMany({
      orderBy: { sortOrder: 'asc' },
      include: {
        services: {
          where: { isActive: true },
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true,
            name: true,
            slug: true,
            shortDescription: true,
            description: true,
            basePriceCents: true,
            durationMinutes: true,
            requiresReport: true,
          },
        },
      },
    });

    res.json({
      currency: env.currency,
      categories: categories.filter((c) => c.services.length > 0),
    });
  }),
);

catalogRouter.get(
  '/services/:slug',
  asyncHandler(async (req, res) => {
    const service = await prisma.service.findUnique({
      where: { slug: req.params.slug },
      include: { category: { select: { name: true, slug: true } } },
    });
    if (!service || !service.isActive) throw notFound('That service is not available');

    res.json({
      currency: env.currency,
      service: {
        id: service.id,
        name: service.name,
        slug: service.slug,
        shortDescription: service.shortDescription,
        description: service.description,
        basePriceCents: service.basePriceCents,
        durationMinutes: service.durationMinutes,
        requiresReport: service.requiresReport,
        category: service.category,
      },
    });
  }),
);

/**
 * "Do you cover my postcode?" — the honest answer, straight from ServiceArea.
 * This endpoint is what makes nationwide expansion a data change.
 */
catalogRouter.get(
  '/coverage',
  asyncHandler(async (req, res) => {
    const { postcode } = parse(
      z.object({ postcode: z.string().trim().min(3).max(12) }),
      req.query,
    );

    const area = await prisma.serviceArea.findFirst({
      where: { postcode, isActive: true },
      select: { id: true, name: true, city: true, region: true, postcode: true },
    });

    res.json({ covered: Boolean(area), area: area ?? null });
  }),
);

catalogRouter.get(
  '/areas',
  asyncHandler(async (req, res) => {
    const areas = await prisma.serviceArea.findMany({
      where: { isActive: true },
      orderBy: [{ region: 'asc' }, { city: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, city: true, region: true, postcode: true },
    });
    res.json({ areas });
  }),
);

catalogRouter.get(
  '/availability',
  asyncHandler(async (req, res) => {
    const { serviceId, postcode, from, days } = parse(
      z.object({
        serviceId: z.string().uuid('Pick a service first'),
        postcode: z.string().trim().min(3).max(12).optional(),
        from: z.string().datetime().optional(),
        days: z.coerce.number().int().min(1).max(30).default(14),
      }),
      req.query,
    );

    const { area, slots } = await getAvailability({
      serviceId,
      postcode,
      from: from ? new Date(from) : new Date(),
      days,
    });

    // Group by local date so the UI can render a day picker without
    // re-deriving the calendar.
    const byDate = new Map();
    for (const slot of slots) {
      const key = new Date(slot.start).toISOString().slice(0, 10);
      if (!byDate.has(key)) byDate.set(key, []);
      byDate.get(key).push(slot);
    }

    res.json({
      area,
      covered: postcode ? Boolean(area) : null,
      days: [...byDate.entries()].map(([date, s]) => ({ date, slots: s })),
      totalSlots: slots.length,
    });
  }),
);
