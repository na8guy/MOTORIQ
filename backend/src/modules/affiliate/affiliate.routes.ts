import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { awin } from '../../integrations/affiliate/awin.client.js';
import { NotFound } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { commissionSummary, offersFor, syncCommissions, type OfferCategory } from './affiliate.service.js';

export default async function affiliateRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', app.authenticate);

  /**
   * Tracked offers for a category.
   *
   * Free to everyone — an affiliate link earns whether or not the member pays
   * us a subscription, and gating it would cost revenue for no reason.
   */
  app.get('/offers', async (req) => {
    const { category } = z
      .object({ category: z.enum(['INSURANCE', 'BREAKDOWN', 'TYRES', 'SERVICE', 'MOT']) })
      .parse(req.query);

    const offers = await offersFor(req.authUser.sub, category as OfferCategory);

    return {
      offers,
      tracked: awin.isLive,
      note:
        category === 'MOT'
          ? 'MOT is covered by your membership perk and booked with a partner garage, ' +
            'not through an affiliate — so your free MOT still applies.'
          : awin.isLive
            ? null
            : 'Affiliate tracking is not configured, so these are plain links.',
      // Required by the CAP Code: paid links must be identifiable as such.
      disclosure:
        offers.some((o) => o.tracked)
          ? 'We may earn a commission if you buy through these links. It never ' +
            'changes what you pay, and we only list companies we would use ourselves.'
          : null,
    };
  });

  /** A member's own click history — transparency about what we track. */
  app.get('/my-clicks', async (req) => {
    return prisma.affiliateClick.findMany({
      where: { userId: req.authUser.sub },
      orderBy: { clickedAt: 'desc' },
      take: 50,
      select: {
        id: true,
        advertiserName: true,
        category: true,
        clickedAt: true,
        commission: { select: { status: true, transactionDate: true } },
      },
    });
  });

  // ── Admin ──

  app.post('/sync', async (req) => {
    const user = await prisma.user.findUnique({
      where: { id: req.authUser.sub },
      select: { role: true },
    });
    if (user?.role !== 'ADMIN') throw NotFound('Not found');
    const { days } = z.object({ days: z.coerce.number().min(1).max(180).default(45) }).parse(req.query);
    return syncCommissions(days);
  });

  app.get('/commissions', async (req) => {
    const user = await prisma.user.findUnique({
      where: { id: req.authUser.sub },
      select: { role: true },
    });
    if (user?.role !== 'ADMIN') throw NotFound('Not found');
    const summary = await commissionSummary();
    const recent = await prisma.affiliateCommission.findMany({
      orderBy: { transactionDate: 'desc' },
      take: 50,
      include: { click: { select: { userId: true, category: true } } },
    });
    return { summary, recent, live: awin.isLive };
  });
}
