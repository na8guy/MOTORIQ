import { awin } from '../../integrations/affiliate/awin.client.js';
import { prisma } from '../../lib/prisma.js';

/**
 * Affiliate offers and commission tracking.
 *
 * The commercial split this module encodes:
 *
 *   • INSURANCE → affiliate. We are not FCA-authorised, so we cannot quote
 *     premiums. The aggregators are, and are already on Awin. An affiliate
 *     link turns a screen that could only give advice into one that earns.
 *
 *   • TYRES, VALETING, generic servicing → affiliate. No membership perk is
 *     attached, so nothing is lost by handing off.
 *
 *   • MOT and perk-backed servicing → NOT affiliate. A Premium member's free
 *     MOT works because we are the merchant and settle with the garage. Send
 *     them through an affiliate link and they pay the advertiser's price at the
 *     advertiser's checkout — the perk they are paying £39 a month for simply
 *     evaporates. Those stay on the direct-partnership path.
 *
 * That distinction is enforced by OFFERS below, not left to whoever wires up
 * the next screen.
 */

export type OfferCategory = 'INSURANCE' | 'BREAKDOWN' | 'TYRES' | 'SERVICE' | 'MOT';

export interface AffiliateOffer {
  /** Awin advertiser id. */
  advertiserId: string;
  name: string;
  category: OfferCategory;
  description: string;
  destinationUrl: string;
  /** What the advertiser typically pays, for our own reporting. */
  commissionNote: string;
}

/**
 * The advertisers we surface, and where each link lands.
 *
 * Deliberately a curated list rather than "everything we have joined on Awin":
 * a motoring membership recommending a random advertiser because it pays well
 * is exactly how these products lose trust. Each entry is here because it is
 * genuinely the thing a member in that situation should look at.
 *
 * advertiserId values must be replaced with the real Awin merchant ids once the
 * programmes are joined — they are the one thing that cannot be guessed, and a
 * wrong id sends the click to the wrong advertiser (or nowhere).
 */
export const OFFERS: AffiliateOffer[] = [
  {
    advertiserId: 'AWIN_MID_COMPARETHEMARKET',
    name: 'Compare the Market',
    category: 'INSURANCE',
    description: 'Large panel — often includes insurers the others miss',
    destinationUrl: 'https://www.comparethemarket.com/car-insurance/',
    commissionNote: 'Typically a fixed fee per completed quote or sale',
  },
  {
    advertiserId: 'AWIN_MID_MONEYSUPERMARKET',
    name: 'MoneySuperMarket',
    category: 'INSURANCE',
    description: 'Good coverage of mainstream insurers',
    destinationUrl: 'https://www.moneysupermarket.com/car-insurance/',
    commissionNote: 'Typically a fixed fee per completed quote or sale',
  },
  {
    advertiserId: 'AWIN_MID_CONFUSED',
    name: 'Confused.com',
    category: 'INSURANCE',
    description: 'Shows the cheapest across several panels',
    destinationUrl: 'https://www.confused.com/car-insurance',
    commissionNote: 'Typically a fixed fee per completed quote or sale',
  },
  {
    advertiserId: 'AWIN_MID_RAC',
    name: 'RAC Breakdown Cover',
    category: 'BREAKDOWN',
    description: 'Nationwide recovery',
    destinationUrl: 'https://www.rac.co.uk/breakdown-cover',
    commissionNote: 'Percentage of the policy',
  },
  {
    advertiserId: 'AWIN_MID_BLACKCIRCLES',
    name: 'Blackcircles',
    category: 'TYRES',
    description: 'Order online, fitted locally',
    destinationUrl: 'https://www.blackcircles.com/',
    commissionNote: 'Percentage of the order',
  },
  {
    advertiserId: 'AWIN_MID_HALFORDS',
    name: 'Halfords',
    category: 'SERVICE',
    description: 'Servicing, parts and repairs',
    destinationUrl: 'https://www.halfords.com/motoring/',
    commissionNote: 'Percentage of the order',
  },
];

/**
 * Offers for a category, each with a tracked link and a click recorded.
 *
 * The click row is written BEFORE the member is redirected, because a
 * commission arrives days later carrying only our clickRef — without the row
 * there is nothing to attribute it to, and the money becomes anonymous.
 */
export async function offersFor(
  userId: string,
  category: OfferCategory,
): Promise<
  {
    advertiserId: string;
    name: string;
    description: string;
    url: string;
    tracked: boolean;
  }[]
> {
  // MOT is deliberately excluded: it is perk-backed, and an affiliate link
  // would quietly strip a paying member of their free MOT.
  if (category === 'MOT') return [];

  const matching = OFFERS.filter((o) => o.category === category);
  const results = [];

  for (const offer of matching) {
    if (!awin.isLive) {
      // Not configured: still show the advertiser, but link to them plainly.
      // A member looking for insurance should get the link either way; we just
      // do not earn on it.
      results.push({
        advertiserId: offer.advertiserId,
        name: offer.name,
        description: offer.description,
        url: offer.destinationUrl,
        tracked: false,
      });
      continue;
    }

    const clickRef = awin.newClickRef();
    await prisma.affiliateClick.create({
      data: {
        userId,
        clickRef,
        advertiserId: offer.advertiserId,
        advertiserName: offer.name,
        category: offer.category,
        destinationUrl: offer.destinationUrl,
      },
    });

    results.push({
      advertiserId: offer.advertiserId,
      name: offer.name,
      description: offer.description,
      url: awin.buildTrackedLink({
        advertiserId: offer.advertiserId,
        destinationUrl: offer.destinationUrl,
        clickRef,
      }),
      tracked: true,
    });
  }

  return results;
}

/**
 * Pull commissions from Awin and reconcile them.
 *
 * Re-reads a TRAILING WINDOW rather than only what is new, because a
 * commission's status changes after the fact — advertisers approve or decline
 * days later, and a decline that we never re-read would sit in our books
 * forever as revenue that does not exist.
 */
export async function syncCommissions(daysBack = 45): Promise<{
  fetched: number;
  created: number;
  updated: number;
  attributed: number;
}> {
  if (!awin.isLive) {
    console.log('[affiliate] AWIN not configured — skipping commission sync');
    return { fetched: 0, created: 0, updated: 0, attributed: 0 };
  }

  const until = new Date();
  const since = new Date(until.getTime() - daysBack * 24 * 60 * 60 * 1000);

  // Awin caps a request at roughly a month, so walk the window in slices.
  const slices: [Date, Date][] = [];
  let cursor = since;
  while (cursor < until) {
    const end = new Date(Math.min(cursor.getTime() + 28 * 864e5, until.getTime()));
    slices.push([cursor, end]);
    cursor = end;
  }

  let fetched = 0;
  let created = 0;
  let updated = 0;
  let attributed = 0;

  for (const [from, to] of slices) {
    const txns = await awin.transactions(from, to);
    fetched += txns.length;

    for (const t of txns) {
      // Attribute back to the member who generated the click, if we can.
      const click = t.clickRef
        ? await prisma.affiliateClick.findUnique({ where: { clickRef: t.clickRef } })
        : null;
      if (click) attributed++;

      const data = {
        clickId: click?.id ?? null,
        advertiserId: t.advertiserId,
        advertiserName: t.advertiserName,
        status: t.commissionStatus.toUpperCase(),
        // Awin reports major units; we store minor everywhere.
        saleAmountMinor: Math.round(t.saleAmount * 100),
        commissionAmountMinor: Math.round(t.commissionAmount * 100),
        currency: t.currency,
        transactionDate: new Date(t.transactionDate),
        validationDate: t.validationDate ? new Date(t.validationDate) : null,
      };

      const existing = await prisma.affiliateCommission.findUnique({
        where: { externalId: t.id },
      });
      if (existing) {
        // Status and amounts can both change after the fact.
        await prisma.affiliateCommission.update({ where: { id: existing.id }, data });
        updated++;
      } else {
        await prisma.affiliateCommission.create({ data: { externalId: t.id, ...data } });
        created++;
      }
    }
  }

  console.log(
    `[affiliate] synced ${fetched} transaction(s): ${created} new, ${updated} updated, ${attributed} attributed to members`,
  );
  return { fetched, created, updated, attributed };
}

/**
 * Commission totals. APPROVED is kept separate from PENDING on purpose —
 * a pending commission is not income, because advertisers decline them, and
 * reporting the two together would overstate revenue exactly the way counting
 * unconfirmed fill-ups overstated member savings.
 */
export async function commissionSummary(): Promise<{
  approvedMinor: number;
  pendingMinor: number;
  declinedMinor: number;
  count: number;
}> {
  const rows = await prisma.affiliateCommission.groupBy({
    by: ['status'],
    _sum: { commissionAmountMinor: true },
    _count: true,
  });
  const pick = (s: string): number =>
    rows.find((r) => r.status === s)?._sum.commissionAmountMinor ?? 0;
  return {
    approvedMinor: pick('APPROVED'),
    pendingMinor: pick('PENDING'),
    declinedMinor: pick('DECLINED'),
    count: rows.reduce((n, r) => n + r._count, 0),
  };
}
