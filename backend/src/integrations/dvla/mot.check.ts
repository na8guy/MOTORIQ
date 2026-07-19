/**
 * Verifies the DVSA MOT History credentials end to end.
 *
 * Run:  npm run check:mot -- AB12CDE
 *
 * Tests the two halves separately, because they fail for different reasons and
 * a single "it didn't work" tells you nothing:
 *
 *   1. OAuth  — client id + secret + tenant token URL + scope. A failure here
 *                is Azure rejecting the app registration.
 *   2. API    — the x-api-key against the MOT History endpoint. A failure here
 *                means the token is fine but the key isn't provisioned.
 *
 * Prints exactly which one failed and what to do about it.
 */
import { request } from 'undici';
import { env } from '../../config/env.js';
import { dvla } from './dvla.client.js';

const vrn = (process.argv[2] ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

function report(label: string, ok: boolean, detail: string): void {
  console.log(`${ok ? '✓' : '✗'} ${label.padEnd(22)} ${detail}`);
}

async function main(): Promise<void> {
  console.log('DVSA MOT History — credential check\n');

  const haveId = !!env.MOT_HISTORY_CLIENT_ID;
  const haveSecret = !!env.MOT_HISTORY_CLIENT_SECRET;
  const haveKey = !!env.MOT_HISTORY_API_KEY;

  report('client id', haveId, haveId ? 'set' : 'MISSING — set MOT_HISTORY_CLIENT_ID');
  report('client secret', haveSecret, haveSecret ? 'set' : 'MISSING — set MOT_HISTORY_CLIENT_SECRET');
  report('api key', haveKey, haveKey ? 'set' : 'MISSING — set MOT_HISTORY_API_KEY');
  report('token url', true, env.MOT_HISTORY_TOKEN_URL);
  report('scope', true, env.MOT_HISTORY_SCOPE);
  console.log('');

  if (!haveId || !haveSecret || !haveKey) {
    console.error('Set the missing variables and run again.');
    process.exit(1);
  }

  // ── 1. OAuth ──
  let token: string | null = null;
  try {
    const form = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: env.MOT_HISTORY_CLIENT_ID!,
      client_secret: env.MOT_HISTORY_CLIENT_SECRET!,
      scope: env.MOT_HISTORY_SCOPE,
    });
    const res = await request(env.MOT_HISTORY_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    const body = (await res.body.json()) as {
      access_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };
    if (res.statusCode >= 400 || !body.access_token) {
      report('OAuth token', false, `${body.error ?? res.statusCode}`);
      const desc = body.error_description ?? '';
      console.error(`\n  ${(desc.split('Trace ID')[0] ?? desc).trim()}`);
      console.error(
        '\n  This is Azure rejecting the app registration — check the client id and ' +
          'secret, and that the secret has not expired in the DVSA portal.',
      );
      process.exit(1);
    }
    token = body.access_token;
    report('OAuth token', true, `granted, expires in ${body.expires_in ?? '?'}s`);
  } catch (err) {
    report('OAuth token', false, err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  // ── 2. The API itself ──
  const testVrn = vrn || 'AA19AAA';
  try {
    const res = await request(`${env.MOT_HISTORY_BASE_URL}/registration/${testVrn}`, {
      method: 'GET',
      headers: {
        'x-api-key': env.MOT_HISTORY_API_KEY!,
        authorization: `Bearer ${token}`,
        accept: 'application/json',
      },
    });
    const text = await res.body.text();

    if (res.statusCode === 404) {
      report('MOT History API', true, `reachable — no record for ${testVrn} (a 404 is a valid answer)`);
    } else if (res.statusCode === 403 || res.statusCode === 401) {
      report('MOT History API', false, `${res.statusCode} — token is valid but the API key was rejected`);
      console.error(`  ${text.slice(0, 200)}`);
      console.error('\n  Check MOT_HISTORY_API_KEY, and that the key is enabled for this environment.');
      process.exit(1);
    } else if (res.statusCode >= 400) {
      report('MOT History API', false, `${res.statusCode}: ${text.slice(0, 160)}`);
      process.exit(1);
    } else {
      const data = JSON.parse(text) as {
        make?: string;
        model?: string;
        motTests?: { expiryDate?: string; odometerValue?: string }[];
      };
      const latest = data.motTests?.[0];
      report('MOT History API', true, `${data.make ?? '?'} ${data.model ?? ''}`.trim());
      if (latest?.expiryDate) {
        console.log(`    MOT expires ${latest.expiryDate}, ${latest.odometerValue ?? '?'} miles`);
      }
    }
  } catch (err) {
    report('MOT History API', false, err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  // ── 3. Through our own client, which is what actually runs in production ──
  if (vrn) {
    console.log('');
    const lookup = await dvla.lookup(vrn);
    console.log(`Via dvla.lookup("${vrn}"): source=${lookup.source}`);
    console.log(
      `  ${lookup.make ?? '?'} ${lookup.model ?? ''} ${lookup.colour ?? ''} ${lookup.year ?? ''}`.trim(),
    );
    console.log(`  MOT ${lookup.motStatus ?? '?'} expires ${lookup.motExpiryDate ?? '—'}`);
    console.log(`  Tax ${lookup.taxStatus ?? '?'} due ${lookup.taxDueDate ?? '—'}`);
    if (lookup.error) console.log(`  note: ${lookup.error}`);
    if (lookup.source === 'mock') {
      console.log('\n  ⚠ Returned MOCK data. DVLA_MOCK is probably still true — set it to false.');
    }
  }

  console.log('\nAll checks passed ✓');
}

main().catch((err) => {
  console.error('check failed:', err);
  process.exit(1);
});
