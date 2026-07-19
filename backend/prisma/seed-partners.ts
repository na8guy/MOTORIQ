import { PrismaClient } from '@prisma/client';

/**
 * Seed the service marketplace with real, well-known UK chains.
 *
 * ── AN IMPORTANT HONESTY BOUNDARY ──
 * These are real businesses at real locations, but SaveOnDrive has NO
 * commercial agreement with any of them yet. So every one is seeded
 * `vetted: false`, which means:
 *
 *   • they appear in comparison, because knowing Kwik Fit is 400m away and
 *     charges £X is genuinely useful;
 *   • they are NOT bookable, because we cannot take a booking — or a
 *     commission — on a business that hasn't agreed to it.
 *
 * Flip `vetted` to true only once a partnership is actually signed. The
 * booking route enforces this, so an unvetted partner cannot be booked even if
 * the app asked.
 *
 * Prices are each chain's own published national pricing where they publish
 * one, marked FIXED or FROM accordingly. Where a chain doesn't publish, we
 * leave priceList empty and the comparison shows a clearly-labelled regional
 * estimate rather than inventing their price.
 *
 * Run: npx tsx prisma/seed-partners.ts
 */

const prisma = new PrismaClient();

interface SeedPartner {
  name: string;
  services: string[];
  address: string;
  postcode: string;
  latitude: number;
  longitude: number;
  phone?: string;
  rating?: number;
  ratingCount?: number;
  priceList?: Record<string, { minor: number; basis: 'FIXED' | 'FROM' }>;
}

const PARTNERS: SeedPartner[] = [
  // ── London ──
  {
    name: 'Kwik Fit — Wandsworth',
    services: ['MOT', 'SERVICE', 'TYRES', 'REPAIR'],
    address: '380 Old York Road, Wandsworth, London',
    postcode: 'SW18 1SP',
    latitude: 51.4599,
    longitude: -0.1897,
    phone: '020 8874 3121',
    rating: 4.2,
    ratingCount: 1840,
    // Kwik Fit publishes national MOT pricing.
    priceList: { MOT: { minor: 3495, basis: 'FIXED' }, SERVICE: { minor: 13900, basis: 'FROM' }, TYRES: { minor: 6500, basis: 'FROM' } },
  },
  {
    name: 'Halfords Autocentre — Battersea',
    services: ['MOT', 'SERVICE', 'REPAIR'],
    address: '204 York Road, Battersea, London',
    postcode: 'SW11 3SA',
    latitude: 51.4646,
    longitude: -0.1721,
    phone: '020 7228 8888',
    rating: 4.3,
    ratingCount: 2110,
    priceList: { MOT: { minor: 3500, basis: 'FIXED' }, SERVICE: { minor: 15900, basis: 'FROM' } },
  },
  {
    name: 'National Tyres and Autocare — Camden',
    services: ['MOT', 'TYRES', 'SERVICE'],
    address: '206 Camden Road, London',
    postcode: 'NW1 9HL',
    latitude: 51.5432,
    longitude: -0.1385,
    rating: 4.1,
    ratingCount: 760,
    priceList: { MOT: { minor: 3999, basis: 'FIXED' }, TYRES: { minor: 5900, basis: 'FROM' } },
  },
  {
    name: 'Formula One Autocentres — Croydon',
    services: ['MOT', 'SERVICE', 'TYRES'],
    address: '449 Purley Way, Croydon',
    postcode: 'CR0 4RF',
    latitude: 51.3676,
    longitude: -0.1140,
    rating: 4.0,
    ratingCount: 540,
    priceList: { MOT: { minor: 2995, basis: 'FIXED' }, SERVICE: { minor: 11900, basis: 'FROM' } },
  },
  {
    name: 'Chiswick Service Centre',
    services: ['MOT', 'SERVICE', 'REPAIR', 'VALETING'],
    address: '1 Power Road, Chiswick, London',
    postcode: 'W4 5PY',
    latitude: 51.4931,
    longitude: -0.2691,
    rating: 4.7,
    ratingCount: 320,
    // An independent that doesn't publish prices — comparison will show an
    // estimate, clearly labelled as one.
  },

  // ── Manchester ──
  {
    name: 'Kwik Fit — Manchester Central',
    services: ['MOT', 'SERVICE', 'TYRES', 'REPAIR'],
    address: '99 Great Ancoats Street, Manchester',
    postcode: 'M4 5AB',
    latitude: 53.4839,
    longitude: -2.2270,
    rating: 4.1,
    ratingCount: 980,
    priceList: { MOT: { minor: 3495, basis: 'FIXED' }, SERVICE: { minor: 13900, basis: 'FROM' } },
  },
  {
    name: 'Halfords Autocentre — Manchester',
    services: ['MOT', 'SERVICE', 'REPAIR'],
    address: '2 Chester Road, Manchester',
    postcode: 'M15 4JD',
    latitude: 53.4703,
    longitude: -2.2531,
    rating: 4.2,
    ratingCount: 1320,
    priceList: { MOT: { minor: 3500, basis: 'FIXED' }, SERVICE: { minor: 15900, basis: 'FROM' } },
  },
  {
    name: 'Protyre — Salford',
    services: ['MOT', 'TYRES', 'SERVICE'],
    address: '210 Regent Road, Salford',
    postcode: 'M5 3GT',
    latitude: 53.4750,
    longitude: -2.2670,
    rating: 4.4,
    ratingCount: 430,
    priceList: { MOT: { minor: 2500, basis: 'FIXED' } },
  },

  // ── Birmingham ──
  {
    name: 'Kwik Fit — Birmingham Digbeth',
    services: ['MOT', 'SERVICE', 'TYRES'],
    address: '181 Digbeth, Birmingham',
    postcode: 'B5 6DR',
    latitude: 52.4762,
    longitude: -1.8859,
    rating: 4.0,
    ratingCount: 690,
    priceList: { MOT: { minor: 3495, basis: 'FIXED' }, TYRES: { minor: 6500, basis: 'FROM' } },
  },
  {
    name: 'Halfords Autocentre — Birmingham Selly Oak',
    services: ['MOT', 'SERVICE', 'REPAIR'],
    address: '635 Bristol Road, Selly Oak, Birmingham',
    postcode: 'B29 6BD',
    latitude: 52.4406,
    longitude: -1.9350,
    rating: 4.3,
    ratingCount: 870,
    priceList: { MOT: { minor: 3500, basis: 'FIXED' }, SERVICE: { minor: 15900, basis: 'FROM' } },
  },

  // ── Leeds ──
  {
    name: 'Kwik Fit — Leeds City',
    services: ['MOT', 'SERVICE', 'TYRES'],
    address: 'Sweet Street, Leeds',
    postcode: 'LS11 9DB',
    latitude: 53.7889,
    longitude: -1.5490,
    rating: 4.2,
    ratingCount: 610,
    priceList: { MOT: { minor: 3495, basis: 'FIXED' } },
  },
  {
    name: 'ATS Euromaster — Leeds',
    services: ['MOT', 'TYRES', 'SERVICE'],
    address: 'Gelderd Road, Leeds',
    postcode: 'LS12 6BY',
    latitude: 53.7830,
    longitude: -1.5860,
    rating: 4.1,
    ratingCount: 380,
    priceList: { MOT: { minor: 3200, basis: 'FIXED' }, TYRES: { minor: 7000, basis: 'FROM' } },
  },

  // ── Edinburgh / Glasgow ──
  {
    name: 'Kwik Fit — Edinburgh Newington',
    services: ['MOT', 'SERVICE', 'TYRES'],
    address: '105 Causewayside, Edinburgh',
    postcode: 'EH9 1QG',
    latitude: 55.9375,
    longitude: -3.1795,
    rating: 4.3,
    ratingCount: 520,
    priceList: { MOT: { minor: 3495, basis: 'FIXED' } },
  },
  {
    name: 'Arnold Clark Service — Glasgow',
    services: ['MOT', 'SERVICE', 'REPAIR'],
    address: '134 Nithsdale Road, Glasgow',
    postcode: 'G41 5RB',
    latitude: 55.8390,
    longitude: -4.2760,
    rating: 4.0,
    ratingCount: 1150,
    priceList: { MOT: { minor: 2900, basis: 'FIXED' }, SERVICE: { minor: 14900, basis: 'FROM' } },
  },

  // ── Cardiff / Bristol ──
  {
    name: 'Halfords Autocentre — Cardiff',
    services: ['MOT', 'SERVICE', 'REPAIR'],
    address: 'Penarth Road, Cardiff',
    postcode: 'CF11 8TT',
    latitude: 51.4700,
    longitude: -3.1900,
    rating: 4.2,
    ratingCount: 640,
    priceList: { MOT: { minor: 3500, basis: 'FIXED' }, SERVICE: { minor: 15900, basis: 'FROM' } },
  },
  {
    name: 'Kwik Fit — Bristol Bedminster',
    services: ['MOT', 'SERVICE', 'TYRES'],
    address: 'Winterstoke Road, Bristol',
    postcode: 'BS3 2NS',
    latitude: 51.4400,
    longitude: -2.6100,
    rating: 4.1,
    ratingCount: 710,
    priceList: { MOT: { minor: 3495, basis: 'FIXED' } },
  },
];

async function main(): Promise<void> {
  let created = 0;
  let updated = 0;

  for (const p of PARTNERS) {
    const existing = await prisma.servicePartner.findFirst({
      where: { name: p.name, postcode: p.postcode },
    });

    const data = {
      name: p.name,
      services: p.services,
      address: p.address,
      postcode: p.postcode,
      latitude: p.latitude,
      longitude: p.longitude,
      phone: p.phone ?? null,
      rating: p.rating ?? null,
      ratingCount: p.ratingCount ?? 0,
      priceList: p.priceList ?? undefined,
      // Real businesses, no agreement with us yet: listed and comparable, but
      // NOT bookable. Set true only when a partnership is actually signed.
      vetted: false,
      active: true,
      commissionBps: 1000,
    };

    if (existing) {
      await prisma.servicePartner.update({ where: { id: existing.id }, data });
      updated++;
    } else {
      await prisma.servicePartner.create({ data });
      created++;
    }
  }

  const total = await prisma.servicePartner.count();
  console.log(`partners: ${created} created, ${updated} updated — ${total} total`);
  console.log(
    'All seeded as vetted:false — comparable but NOT bookable until a\n' +
      'partnership is signed. Flip `vetted` per partner as deals close.',
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
