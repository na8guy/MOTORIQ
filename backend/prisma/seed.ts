import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';

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

  // eslint-disable-next-line no-console
  console.log(`✅ Seeded demo user ${email} (password: password123)`);
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
