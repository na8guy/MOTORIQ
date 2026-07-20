import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { BadRequest, NotFound } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { notify } from '../notifications/notifications.service.js';
import { requireFeature } from '../entitlements/entitlements.guard.js';
import { claimPerk, perkBalances } from '../subscriptions/perks.service.js';
import { compareQuotes, type ServiceType } from './quotes.service.js';
import { offersFor } from '../affiliate/affiliate.service.js';

/**
 * One-tap booking for MOTs, servicing, tyres and valeting.
 *
 * The business model is commission: the member gets a vetted garage without
 * ringing round, the garage gets a customer, and we take a percentage of the
 * job. That makes this the first feature that earns rather than costs — which
 * is also why only vetted partners are bookable. Sending someone to a garage
 * we haven't checked, and taking a cut for it, would be indefensible.
 *
 * Membership perks apply automatically: a Premium member's free MOT is claimed
 * from their allowance at booking, so they see £0 rather than being asked to
 * pay and claim it back.
 */

const SERVICE_TYPES = ['MOT', 'SERVICE', 'TYRES', 'VALETING', 'REPAIR'] as const;

const bookBody = z.object({
  partnerId: z.string(),
  serviceType: z.enum(SERVICE_TYPES),
  requestedFor: z.coerce.date(),
  vehicleId: z.string().optional(),
  notes: z.string().max(500).optional(),
});

/** Typical UK prices, used to quote before the garage confirms. */
const INDICATIVE_MINOR: Record<(typeof SERVICE_TYPES)[number], number> = {
  MOT: 5500,
  SERVICE: 14900,
  TYRES: 8000,
  VALETING: 4500,
  REPAIR: 0, // quoted per job — never guessed
};

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(la1) * Math.cos(la2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

export default async function marketplaceRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', app.authenticate);

  /**
   * Garages near a member offering a given service.
   *
   * Browsing is free — seeing what's available is part of the pitch for
   * upgrading. Booking is the Pro feature.
   */
  app.get('/partners', async (req) => {
    const q = z
      .object({
        lat: z.coerce.number().min(-90).max(90),
        lng: z.coerce.number().min(-180).max(180),
        serviceType: z.enum(SERVICE_TYPES).optional(),
        radiusKm: z.coerce.number().positive().max(80).default(25),
        limit: z.coerce.number().int().positive().max(50).default(10),
      })
      .parse(req.query);

    const partners = await prisma.servicePartner.findMany({
      where: {
        active: true,
        ...(q.serviceType ? { services: { has: q.serviceType } } : {}),
      },
      take: 200,
    });

    const withDistance = partners
      .map((p) => ({
        ...p,
        distanceKm:
          Math.round(haversineKm({ lat: q.lat, lng: q.lng }, { lat: p.latitude, lng: p.longitude }) * 10) / 10,
      }))
      .filter((p) => p.distanceKm <= q.radiusKm)
      // Vetted first, then closest — a slightly further vetted garage beats a
      // near one we haven't checked.
      .sort((a, b) => Number(b.vetted) - Number(a.vetted) || a.distanceKm - b.distanceKm)
      .slice(0, q.limit);

    return {
      partners: withDistance.map((p) => ({
        id: p.id,
        name: p.name,
        services: p.services,
        address: p.address,
        postcode: p.postcode,
        distanceKm: p.distanceKm,
        rating: p.rating,
        ratingCount: p.ratingCount,
        vetted: p.vetted,
        bookable: p.vetted,
        indicativeMinor: q.serviceType ? INDICATIVE_MINOR[q.serviceType] || null : null,
      })),
      // Say so rather than showing a mysteriously short list.
      note:
        partners.length === 0
          ? 'No partner garages are onboarded yet — this list fills as partners join.'
          : null,
    };
  });

  /**
   * Shop for the cheapest MOT, service or tyres near you.
   *
   * Free to browse — seeing the spread between garages is the argument for
   * upgrading. Booking at the price is the Pro feature.
   */
  app.get('/compare', async (req) => {
    const q = z
      .object({
        lat: z.coerce.number().min(-90).max(90),
        lng: z.coerce.number().min(-180).max(180),
        serviceType: z.enum(SERVICE_TYPES),
        radiusKm: z.coerce.number().positive().max(80).default(25),
        limit: z.coerce.number().int().positive().max(20).default(8),
        vehicleClass: z.enum(['CAR', 'VAN', 'MOTORCYCLE']).default('CAR'),
      })
      .parse(req.query);

    // Apply whatever the member's membership still covers, so the comparison
    // shows what THEY pay rather than the list price.
    const balances = await perkBalances(req.authUser.sub);
    const kind = q.serviceType === 'MOT' ? 'MOT' : q.serviceType === 'SERVICE' ? 'SERVICE' : null;
    const perk = kind ? balances.find((b) => b.kind === kind) : undefined;
    const perkCoversMinor =
      perk && perk.remaining > 0 ? (kind === 'MOT' ? 5485 : perk.valueMinor) : 0;

    const comparison = await compareQuotes({
      latitude: q.lat,
      longitude: q.lng,
      serviceType: q.serviceType as ServiceType,
      radiusKm: q.radiusKm,
      limit: q.limit,
      vehicleClass: q.vehicleClass,
      perkCoversMinor,
    });

    // Where no vetted garage can take the booking, offer the affiliate route
    // instead of a dead end — EXCEPT for MOT, which is perk-backed. Sending a
    // Premium member to an affiliate MOT would silently cost them the free one
    // they are paying for. See affiliate.service.ts.
    const noneBookable = comparison.quotes.every((q) => !q.bookable);
    const affiliateOffers =
      noneBookable && q.serviceType !== 'MOT'
        ? await offersFor(req.authUser.sub, q.serviceType === 'TYRES' ? 'TYRES' : 'SERVICE')
        : [];

    return {
      ...comparison,
      perkCoversMinor,
      affiliateOffers,
      affiliateNote:
        affiliateOffers.length > 0
          ? 'None of these garages is a booking partner yet, so you can book direct ' +
            'with one of these instead. We may earn a commission — it never changes ' +
            'what you pay.'
          : null,
    };
  });

  /** A member's bookings. */
  app.get('/bookings', async (req) => {
    return prisma.serviceBooking.findMany({
      where: { userId: req.authUser.sub },
      include: { partner: { select: { name: true, address: true, postcode: true, phone: true } } },
      orderBy: { requestedFor: 'desc' },
      take: 50,
    });
  });

  /**
   * Book a job. Pro feature.
   *
   * Applies any membership perk automatically — a free MOT is claimed here so
   * the member sees £0 up front rather than paying and claiming it back.
   */
  app.post(
    '/bookings',
    { onRequest: [requireFeature('booking.marketplace')] },
    async (req, reply) => {
      const body = bookBody.parse(req.body);
      const userId = req.authUser.sub;

      const partner = await prisma.servicePartner.findUnique({ where: { id: body.partnerId } });
      if (!partner || !partner.active) throw NotFound('Garage not found');
      if (!partner.vetted) {
        throw BadRequest('This garage is listed but not yet vetted, so we cannot book it for you');
      }
      if (!partner.services.includes(body.serviceType)) {
        throw BadRequest(`${partner.name} does not offer ${body.serviceType.toLowerCase()}`);
      }
      if (body.requestedFor.getTime() < Date.now()) {
        throw BadRequest('Choose a date in the future');
      }

      if (body.vehicleId) {
        const owned = await prisma.vehicle.findFirst({
          where: { id: body.vehicleId, userId },
          select: { id: true },
        });
        if (!owned) throw NotFound('Vehicle not found');
      }

      const quoted = INDICATIVE_MINOR[body.serviceType] || 0;

      // Claim the membership perk if one covers this. claimPerk is atomic, so
      // two simultaneous bookings can't both spend the same free MOT.
      let perkApplied = 0;
      if (body.serviceType === 'MOT') {
        const claim = await claimPerk(userId, 'MOT', 1);
        if (claim.ok) perkApplied = Math.min(quoted, INDICATIVE_MINOR.MOT);
      } else if (body.serviceType === 'SERVICE') {
        const claim = await claimPerk(userId, 'SERVICE', 1);
        if (claim.ok) {
          const grant = await prisma.perkGrant.findFirst({
            where: { userId, kind: 'SERVICE' },
            orderBy: { createdAt: 'desc' },
          });
          perkApplied = Math.min(quoted, grant?.valueMinor ?? 0);
        }
      }

      const booking = await prisma.serviceBooking.create({
        data: {
          userId,
          vehicleId: body.vehicleId,
          partnerId: partner.id,
          serviceType: body.serviceType,
          requestedFor: body.requestedFor,
          quotedMinor: quoted || null,
          perkAppliedMinor: perkApplied,
          commissionMinor: quoted ? Math.round((quoted * partner.commissionBps) / 10_000) : null,
          notes: body.notes,
        },
        include: { partner: { select: { name: true, phone: true, address: true } } },
      });

      await notify(userId, {
        title: 'Booking requested',
        body: `${partner.name} has your ${body.serviceType.toLowerCase()} request. We'll confirm the slot shortly.`,
        type: 'BOOKING',
        data: { bookingId: booking.id },
      });

      reply.code(201);
      return {
        booking,
        perkAppliedMinor: perkApplied,
        payableMinor: Math.max(0, quoted - perkApplied),
        message:
          perkApplied > 0
            ? `Your membership covers £${(perkApplied / 100).toFixed(2)} of this.`
            : null,
      };
    },
  );

  /** Cancel a booking that hasn't happened yet. */
  app.post('/bookings/:id/cancel', async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const booking = await prisma.serviceBooking.findFirst({
      where: { id, userId: req.authUser.sub },
    });
    if (!booking) throw NotFound('Booking not found');
    if (booking.status === 'COMPLETED') throw BadRequest('That job is already done');

    // NOTE: the perk is deliberately NOT returned to the allowance here.
    // Doing so needs care — a member could otherwise book and cancel
    // repeatedly to keep a free MOT alive across periods. Refunding perks is
    // an ops action for now, not an automatic one.
    return prisma.serviceBooking.update({ where: { id }, data: { status: 'CANCELLED' } });
  });
}
