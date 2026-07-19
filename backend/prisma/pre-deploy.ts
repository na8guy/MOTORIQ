import { PrismaClient } from '@prisma/client';

/**
 * Data migrations that must run BEFORE `prisma db push`.
 *
 * Why this exists: renaming the tier enum from FREE/PLUS/DRIVE/DRIVE_PLUS to
 * FREE/PREMIUM/PRO cannot be done by `db push` alone. Postgres refuses to
 * convert a column to a new enum type while existing rows hold values the new
 * type does not have, and the deploy dies with:
 *
 *   ERROR: invalid input value for enum "SubPlan_new": "DRIVE"
 *
 * The container then keeps serving the previous build, so the symptom is a
 * deploy that looks like it succeeded while the API quietly stays on old code.
 *
 * The fix is to widen the columns to text, remap the values, and drop the old
 * types — after which `db push` can create the new enums cleanly.
 *
 * Every statement is idempotent and guarded, so this is safe to run on every
 * deploy forever, including on a database that has already been migrated or
 * one that is brand new.
 */

const prisma = new PrismaClient();

async function tableExists(table: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = $1
     ) AS exists`,
    table,
  );
  return rows[0]?.exists === true;
}

async function columnType(table: string, column: string): Promise<string | null> {
  const rows = await prisma.$queryRawUnsafe<{ data_type: string; udt_name: string }[]>(
    `SELECT data_type, udt_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
    table,
    column,
  );
  const row = rows[0];
  if (!row) return null;
  return row.data_type === 'USER-DEFINED' ? row.udt_name : row.data_type;
}

/** Map the retired tier names onto the new ones. */
const REMAP_SQL = (table: string, column: string): string => `
  UPDATE "${table}" SET "${column}" = CASE "${column}"
    WHEN 'PLUS'       THEN 'PREMIUM'
    WHEN 'DRIVE'      THEN 'PREMIUM'
    WHEN 'DRIVE_PLUS' THEN 'PRO'
    WHEN 'PREMIUM'    THEN 'PREMIUM'
    WHEN 'PRO'        THEN 'PRO'
    ELSE 'FREE'
  END
`;

async function migrateTierColumn(table: string, column: string, enumName: string): Promise<void> {
  if (!(await tableExists(table))) {
    console.log(`[pre-deploy] ${table} does not exist yet — nothing to migrate`);
    return;
  }

  const type = await columnType(table, column);
  if (type === null) {
    console.log(`[pre-deploy] ${table}.${column} does not exist yet — skipping`);
    return;
  }

  // Already text, or already the new enum with only valid values: just remap
  // defensively and move on.
  if (type === 'text' || type === 'character varying') {
    await prisma.$executeRawUnsafe(REMAP_SQL(table, column));
    console.log(`[pre-deploy] ${table}.${column} is already text — values remapped`);
    return;
  }

  console.log(`[pre-deploy] converting ${table}.${column} (${type}) → text and remapping…`);
  // Drop the default first: it references the old enum type and blocks the
  // ALTER, with an error that does not mention defaults at all.
  await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" ALTER COLUMN "${column}" DROP DEFAULT`);
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "${table}" ALTER COLUMN "${column}" TYPE text USING "${column}"::text`,
  );
  await prisma.$executeRawUnsafe(REMAP_SQL(table, column));
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "${table}" ALTER COLUMN "${column}" SET DEFAULT 'FREE'`,
  );

  // Drop the old type so `db push` can recreate it with the new values.
  await prisma.$executeRawUnsafe(`DROP TYPE IF EXISTS "${enumName}" CASCADE`);
  console.log(`[pre-deploy] ${table}.${column} migrated; dropped type ${enumName}`);
}

async function main(): Promise<void> {
  console.log('[pre-deploy] starting');

  // Membership tiers: FREE/PLUS/DRIVE/DRIVE_PLUS → FREE/PREMIUM/PRO
  await migrateTierColumn('users', 'tier', 'Tier');
  await migrateTierColumn('subscriptions', 'plan', 'SubPlan');

  // The old schema had a mileagePackage column that the new tiers don't use.
  // Leave the data alone — `db push` removes the column, and losing it is
  // intended, but there is no reason to destroy it before we have to.

  console.log('[pre-deploy] done');
}

main()
  .catch((err) => {
    // A failure here means `db push` will fail too, so surface it loudly and
    // stop the deploy rather than let it half-apply.
    console.error('[pre-deploy] FAILED:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
