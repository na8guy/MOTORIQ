import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';
import 'dotenv/config';

const prisma = new PrismaClient();

/**
 * Seeds a demo member so the Flutter app has something to log into.
 *   email:    demo@motoriq.co.uk
 *   password: password123
 */
async function main(): Promise<void> {
  const email = 'demo@motoriq.co.uk';
  const passwordHash = await argon2.hash('password123');

  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      passwordHash,
      firstName: 'Demo',
      lastName: 'Driver',
      tier: 'PLUS',
      wallet: { create: { balanceMinor: 5000 } },
      subscription: { create: { plan: 'PLUS', priceMinor: 599, status: 'ACTIVE' } },
    },
  });

  await prisma.vehicle.upsert({
    where: { userId_registration: { userId: user.id, registration: 'AB12CDE' } },
    update: {},
    create: {
      userId: user.id,
      registration: 'AB12CDE',
      make: 'Volkswagen',
      model: 'Golf',
      year: 2019,
      fuelType: 'PETROL',
      mileage: 42000,
    },
  });

  await prisma.savingsRecord.createMany({
    data: [
      { userId: user.id, category: 'FUEL', amountMinor: 1240, description: 'Cheaper fuel via MOTORIQ' },
      { userId: user.id, category: 'INSURANCE', amountMinor: 8500, description: 'Insurance switch' },
      { userId: user.id, category: 'CASHBACK', amountMinor: 320, description: 'Cashback reward' },
    ],
    skipDuplicates: true,
  });

  // Demo member has passed KYC so money flows are enabled.
  await prisma.kycProfile.upsert({
    where: { userId: user.id },
    update: { status: 'VERIFIED' },
    create: {
      userId: user.id,
      status: 'VERIFIED',
      dateOfBirth: new Date('1990-05-14'),
      addressLine1: '1 Demo Street',
      city: 'London',
      postcode: 'EC1V 9NR',
      country: 'GB',
      documentType: 'DRIVING_LICENCE',
      documentNumber: 'DEMO123456',
      wallesterKycId: 'kyc_mock_demo',
      submittedAt: new Date(),
      verifiedAt: new Date(),
    },
  });

  // A few fuel fill-ups so the AI savings engine has data to work with.
  const now = Date.now();
  await prisma.fuelPurchase.createMany({
    data: [
      { userId: user.id, fuelKind: 'E10', litres: 45, pricePencePerUnit: 138.7, totalMinor: 6242, benchmarkPencePerUnit: 142.4, savedMinor: 167, stationBrand: 'Asda', purchasedAt: new Date(now - 25 * 864e5) },
      { userId: user.id, fuelKind: 'E10', litres: 42, pricePencePerUnit: 139.9, totalMinor: 5876, benchmarkPencePerUnit: 142.4, savedMinor: 105, stationBrand: 'Tesco', purchasedAt: new Date(now - 12 * 864e5) },
      { userId: user.id, fuelKind: 'E10', litres: 48, pricePencePerUnit: 138.7, totalMinor: 6658, benchmarkPencePerUnit: 142.4, savedMinor: 178, stationBrand: 'Asda', purchasedAt: new Date(now - 2 * 864e5) },
    ],
    skipDuplicates: true,
  });

  // Admin/ops account for the dashboard at /admin.
  const adminEmail = process.env.ADMIN_EMAIL ?? 'admin@motoriq.co.uk';
  const adminPassword = process.env.ADMIN_PASSWORD ?? 'admin12345';
  await prisma.user.upsert({
    where: { email: adminEmail },
    update: { role: 'ADMIN' },
    create: {
      email: adminEmail,
      passwordHash: await argon2.hash(adminPassword),
      firstName: 'Ops',
      lastName: 'Admin',
      role: 'ADMIN',
      wallet: { create: {} },
      subscription: { create: { plan: 'FREE' } },
    },
  });

  // eslint-disable-next-line no-console
  console.log(`✅ Seeded demo user ${email} (password: password123)`);
  // eslint-disable-next-line no-console
  console.log(`✅ Seeded admin ${adminEmail} (password: ${adminPassword})`);
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
