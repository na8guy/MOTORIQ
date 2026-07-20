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

/**
 * Recreate the enum type with its new values and convert the column back.
 *
 * Doing the FULL conversion here — rather than leaving the column as text for
 * `db push` to finish — is deliberate. `db push` refuses a text→enum narrowing
 * without --accept-data-loss, and we cannot rely on that flag being present:
 * Render keeps the start command stored on the service, so a change to
 * startCommand in render.yaml is silently ignored on an existing service.
 * Leaving the database in exactly the state the schema expects means `db push`
 * has nothing to do and nothing to warn about, whatever command runs it.
 */
async function finishEnum(
  table: string,
  column: string,
  enumName: string,
  values: string[],
): Promise<void> {
  const type = await columnType(table, column);
  if (type === enumName) {
    console.log(`[pre-deploy] ${table}.${column} is already ${enumName}`);
    return;
  }
  if (type === null) return;

  const literals = values.map((v) => `'${v}'`).join(', ');
  await prisma.$executeRawUnsafe(
    `DO $$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = '${enumName}') THEN
         CREATE TYPE "${enumName}" AS ENUM (${literals});
       END IF;
     END $$;`,
  );
  await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" ALTER COLUMN "${column}" DROP DEFAULT`);
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "${table}" ALTER COLUMN "${column}" TYPE "${enumName}" USING "${column}"::"${enumName}"`,
  );
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "${table}" ALTER COLUMN "${column}" SET DEFAULT 'FREE'::"${enumName}"`,
  );
  console.log(`[pre-deploy] ${table}.${column} converted to ${enumName}`);
}

/**
 * Ensure a nullable column and its unique index exist.
 *
 * Adding a unique constraint ALSO trips Prisma's data-loss guard — I assumed it
 * wouldn't, and the deploy failed a second time on exactly that:
 *
 *   • A unique constraint covering the columns [stripeCustomerId] on the table
 *     users will be added. If there are existing duplicate values, this will fail.
 *
 * Creating them here means `db push` finds them already present and has nothing
 * to warn about. The index name must match Prisma's own convention
 * (`<table>_<column>_key`) or Prisma won't recognise it and will try again.
 *
 * Postgres allows unlimited NULLs in a unique index, so adding these to a table
 * of existing rows — where every value is NULL — cannot fail.
 */
async function ensureUniqueColumn(table: string, column: string): Promise<void> {
  if (!(await tableExists(table))) return;

  const existing = await columnType(table, column);
  if (existing === null) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "${column}" text`,
    );
    console.log(`[pre-deploy] added ${table}.${column}`);
  }

  const indexName = `${table}_${column}_key`;
  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS "${indexName}" ON "${table}" ("${column}")`,
  );
  console.log(`[pre-deploy] unique index ${indexName} ensured`);
}

async function main(): Promise<void> {
  console.log('[pre-deploy] starting');

  // Membership tiers: FREE/PLUS/DRIVE/DRIVE_PLUS → FREE/PREMIUM/PRO.
  // Two passes: widen to text and remap the values, then narrow back onto the
  // new enum. Splitting it is what makes the conversion possible at all —
  // Postgres will not convert directly between enums with different members.
  await migrateTierColumn('users', 'tier', 'Tier');
  await migrateTierColumn('subscriptions', 'plan', 'SubPlan');

  await finishEnum('users', 'tier', 'Tier', ['FREE', 'PREMIUM', 'PRO']);
  await finishEnum('subscriptions', 'plan', 'SubPlan', ['FREE', 'PREMIUM', 'PRO']);

  // Stripe identifiers. Their unique constraints trip the same data-loss guard
  // as the enum change did, so create them here rather than leave them to
  // `db push`, which cannot add them without a flag we cannot set.
  await ensureUniqueColumn('users', 'stripeCustomerId');
  await ensureUniqueColumn('subscriptions', 'stripeSubscriptionId');

  console.log('[pre-deploy] done');
}

main()
  .catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    // At BUILD time the database may legitimately be unreachable, and failing
    // the build for that would block a deploy that would otherwise be fine —
    // the start command's `db push` still runs and will fail loudly there if
    // something is genuinely wrong. A real migration error (reachable database,
    // bad SQL) still stops the deploy, which is what we want.
    const unreachable =
      /ECONNREFUSED|ENOTFOUND|Can't reach database|timeout|P1001|P1002|Environment variable not found/i.test(
        msg,
      );
    if (unreachable) {
      console.warn(`[pre-deploy] database not reachable here — skipping (${msg.split('\n')[0]})`);
      return;
    }
    console.error('[pre-deploy] FAILED:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
