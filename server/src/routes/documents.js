/**
 * Authenticated document download.
 *
 * Documents are NEVER served as static files. A provider's license and a job
 * report are private; this route checks entitlement per request and streams the
 * bytes from whichever storage driver is configured.
 */
import express from 'express';
import { prisma } from '../db.js';
import { asyncHandler, forbidden, notFound } from '../lib/http.js';
import { requireAuth } from '../lib/auth.js';
import { getObject } from '../services/storage.js';

export const documentRouter = express.Router();
documentRouter.use(requireAuth);

documentRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const doc = await prisma.document.findUnique({
      where: { id: req.params.id },
      include: {
        job: { select: { id: true, customerId: true, providerId: true } },
        provider: { select: { id: true, userId: true } },
      },
    });
    if (!doc) throw notFound('Document not found');

    const myProviderId = req.user.provider?.id ?? null;

    const entitled =
      req.user.role === 'ADMIN' ||
      // the customer whose job this document belongs to
      (doc.job && doc.job.customerId === req.user.id) ||
      // the provider assigned to that job
      (doc.job && myProviderId && doc.job.providerId === myProviderId) ||
      // the provider whose own onboarding document this is
      (doc.provider && doc.provider.userId === req.user.id);

    if (!entitled) throw forbidden('You do not have access to this document');

    let body;
    try {
      body = await getObject(doc.storageKey);
    } catch (err) {
      // A row with no bytes behind it is a real operational fault, not a 404
      // for the user to puzzle over.
      console.error('[documents] missing object', doc.id, doc.storageKey, err.message);
      throw notFound('That file could not be retrieved — our team has been alerted');
    }

    res.setHeader('Content-Type', doc.mimeType);
    res.setHeader('Content-Length', body.length);
    // `inline` so a PDF report opens in the browser; the filename is quoted and
    // stripped of anything that could break the header.
    const safeName = doc.fileName.replace(/["\\\r\n]/g, '_');
    res.setHeader('Content-Disposition', `inline; filename="${safeName}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(body);
  }),
);
