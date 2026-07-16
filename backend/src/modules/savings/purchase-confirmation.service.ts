import { prisma } from '../../lib/prisma.js';
import { notify } from '../notifications/notifications.service.js';

/**
 * Deciding whether a member actually bought fuel.
 *
 * Tapping "Navigate here" proves *intent*, nothing more. They might arrive and
 * change their mind, find a queue, or pay somewhere else entirely. Counting
 * intent as savings would make the headline number — the one members judge the
 * whole product on — fiction.
 *
 * So a trip through the app creates a PENDING intent that is never counted, and
 * only becomes CONFIRMED when we have real evidence:
 *
 *   1. CARD_MATCH — a Wallester transaction at that merchant, around that time,
 *      for a plausible amount. Money moved: authoritative, needs no prompting.
 *   2. MEMBER — they answered "yes, I filled up" when asked.
 *
 * Anything unanswered EXPIRES and is never counted. Savings should read low and
 * true rather than high and invented.
 */

/** How long an intent stays open before we stop believing in it. */
const INTENT_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Wait before asking. Prompting the instant they tap Navigate is absurd — they
 * haven't driven there yet. Long enough to have arrived and filled up.
 */
const PROMPT_AFTER_MS = 45 * 60 * 1000;

/** A card transaction this far from the intent is a different trip. */
const CARD_MATCH_WINDOW_MS = 3 * 60 * 60 * 1000;

export interface RecordIntentInput {
  userId: string;
  vehicleId?: string;
  fuelKind: string;
  /** Advertised price at the station when they set off. */
  pricePencePerUnit: number;
  /** Local average at that moment — the benchmark savings are measured against. */
  benchmarkPencePerUnit?: number;
  /** Estimated fill; the member can correct it on confirmation. */
  estimatedLitres: number;
  siteId?: string;
  stationBrand?: string;
  stationPostcode?: string;
  latitude?: number;
  longitude?: number;
}

/**
 * Record that a member set off for a station. Creates a PENDING purchase that
 * contributes nothing to savings until it's confirmed.
 */
export async function recordIntent(input: RecordIntentInput) {
  // Don't stack duplicates when someone taps Navigate a few times, or
  // re-checks the route — that's one trip, not three.
  const recent = await prisma.fuelPurchase.findFirst({
    where: {
      userId: input.userId,
      status: 'PENDING',
      siteId: input.siteId ?? undefined,
      createdAt: { gte: new Date(Date.now() - PROMPT_AFTER_MS) },
    },
  });
  if (recent) return recent;

  const litres = input.estimatedLitres;
  const totalMinor = Math.round(litres * input.pricePencePerUnit);
  const savedMinor =
    input.benchmarkPencePerUnit != null
      ? Math.max(0, Math.round((input.benchmarkPencePerUnit - input.pricePencePerUnit) * litres))
      : 0;

  return prisma.fuelPurchase.create({
    data: {
      userId: input.userId,
      vehicleId: input.vehicleId,
      fuelKind: input.fuelKind,
      litres,
      pricePencePerUnit: input.pricePencePerUnit,
      totalMinor,
      benchmarkPencePerUnit: input.benchmarkPencePerUnit,
      savedMinor,
      siteId: input.siteId,
      stationBrand: input.stationBrand,
      stationPostcode: input.stationPostcode,
      latitude: input.latitude,
      longitude: input.longitude,
      status: 'PENDING',
      expiresAt: new Date(Date.now() + INTENT_TTL_MS),
    },
  });
}

/**
 * The member answered the "did you fill up?" prompt.
 *
 * `actualLitres`/`actualPricePence` let them correct our estimate, which also
 * corrects the saving — we'd rather record what really happened than defend our
 * guess.
 */
export async function confirmPurchase(
  userId: string,
  purchaseId: string,
  input: { filledUp: boolean; actualLitres?: number; actualPricePence?: number } = {
    filledUp: true,
  },
) {
  const purchase = await prisma.fuelPurchase.findFirst({ where: { id: purchaseId, userId } });
  if (!purchase) return null;

  if (!input.filledUp) {
    return prisma.fuelPurchase.update({
      where: { id: purchaseId },
      data: { status: 'DECLINED', confirmedAt: new Date(), savedMinor: 0 },
    });
  }

  const litres = input.actualLitres ?? purchase.litres;
  const price = input.actualPricePence ?? purchase.pricePencePerUnit;
  const savedMinor =
    purchase.benchmarkPencePerUnit != null
      ? Math.max(0, Math.round((purchase.benchmarkPencePerUnit - price) * litres))
      : 0;

  return prisma.fuelPurchase.update({
    where: { id: purchaseId },
    data: {
      status: 'CONFIRMED',
      confirmationSource: 'MEMBER',
      confirmedAt: new Date(),
      litres,
      pricePencePerUnit: price,
      totalMinor: Math.round(litres * price),
      savedMinor,
      purchasedAt: purchase.purchasedAt,
    },
  });
}

/**
 * Try to confirm an intent from a real card transaction. Called when a wallet
 * transaction settles.
 *
 * Matching is deliberately conservative — a wrong match would credit a saving
 * that never happened, which is the exact failure this whole flow exists to
 * prevent. We require the same member, a PENDING intent at that merchant,
 * within a few hours, for a plausible amount.
 */
export async function tryConfirmFromCard(input: {
  userId: string;
  merchantName?: string;
  amountMinor: number;
  occurredAt?: Date;
}): Promise<{ matched: boolean; purchaseId?: string }> {
  const at = input.occurredAt ?? new Date();

  const candidates = await prisma.fuelPurchase.findMany({
    where: {
      userId: input.userId,
      status: 'PENDING',
      createdAt: { gte: new Date(at.getTime() - CARD_MATCH_WINDOW_MS) },
    },
    orderBy: { createdAt: 'desc' },
  });
  if (candidates.length === 0) return { matched: false };

  const merchant = (input.merchantName ?? '').toLowerCase();

  const match = candidates.find((c) => {
    // Brand must line up when the transaction names a merchant. Card merchant
    // strings are messy ("ASDA STORES 4021 LEEDS"), so substring both ways.
    if (merchant && c.stationBrand) {
      const brand = c.stationBrand.toLowerCase();
      if (!merchant.includes(brand) && !brand.includes(merchant.split(/\s+/)[0] ?? '')) {
        return false;
      }
    }
    // Amount must be plausible for a fill-up at the advertised price: anywhere
    // from a splash to a big tank. Outside that it's a coffee, not fuel.
    const litresImplied = input.amountMinor / c.pricePencePerUnit;
    return litresImplied >= 5 && litresImplied <= 120;
  });

  if (!match) return { matched: false };

  const litres = input.amountMinor / match.pricePencePerUnit;
  const savedMinor =
    match.benchmarkPencePerUnit != null
      ? Math.max(
          0,
          Math.round((match.benchmarkPencePerUnit - match.pricePencePerUnit) * litres),
        )
      : 0;

  await prisma.fuelPurchase.update({
    where: { id: match.id },
    data: {
      status: 'CONFIRMED',
      confirmationSource: 'CARD_MATCH',
      confirmedAt: new Date(),
      // The card knows the true spend, so trust it over our estimate.
      litres: Math.round(litres * 100) / 100,
      totalMinor: input.amountMinor,
      savedMinor,
      purchasedAt: at,
    },
  });
  console.log(
    `[savings] card match confirmed purchase ${match.id} (${match.stationBrand}) for user ${input.userId}`,
  );
  return { matched: true, purchaseId: match.id };
}

/**
 * Ask about intents old enough to have happened, and expire ones nobody ever
 * answered. Run from the daily job.
 */
export async function sweepIntents(): Promise<{ prompted: number; expired: number }> {
  const now = new Date();

  // 1. Expire the forgotten ones. Never counted.
  const expired = await prisma.fuelPurchase.updateMany({
    where: { status: 'PENDING', expiresAt: { lt: now } },
    data: { status: 'EXPIRED', savedMinor: 0 },
  });

  // 2. Ask about the ones old enough to have happened but not yet asked about.
  const toPrompt = await prisma.fuelPurchase.findMany({
    where: {
      status: 'PENDING',
      promptedAt: null,
      createdAt: { lte: new Date(now.getTime() - PROMPT_AFTER_MS) },
    },
    take: 200,
  });

  for (const p of toPrompt) {
    const where = p.stationBrand
      ? `${p.stationBrand}${p.stationPostcode ? ` (${p.stationPostcode})` : ''}`
      : 'the station you headed to';
    await notify(p.userId, {
      title: 'Did you fill up?',
      body: `Confirm your fill-up at ${where} so we can add it to your savings.`,
      type: 'FUEL_CONFIRM',
      data: { purchaseId: p.id },
    });
    await prisma.fuelPurchase.update({ where: { id: p.id }, data: { promptedAt: now } });
  }

  if (expired.count || toPrompt.length) {
    console.log(
      `[savings] intents swept — ${toPrompt.length} prompted, ${expired.count} expired unconfirmed`,
    );
  }
  return { prompted: toPrompt.length, expired: expired.count };
}
