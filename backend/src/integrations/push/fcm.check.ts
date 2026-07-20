/**
 * Verifies the FCM service-account credentials.
 *
 * Run: npm run check:push
 *
 * Tests the OAuth exchange only — actually delivering a notification needs a
 * real device token, which only the app can produce. A pass here means the
 * server can talk to Firebase; it does NOT mean notifications arrive, because
 * that also requires the app to register a real token (see DEPLOYMENT.md).
 */
import { env } from '../../config/env.js';

function report(label: string, ok: boolean, detail: string): void {
  console.log(`${ok ? '✓' : '✗'} ${label.padEnd(20)} ${detail}`);
}

async function main(): Promise<void> {
  console.log('Firebase Cloud Messaging — credential check\n');

  const provider = env.PUSH_PROVIDER;
  const haveProject = !!env.FCM_PROJECT_ID;
  const haveEmail = !!env.FCM_CLIENT_EMAIL;
  const haveKey = !!env.FCM_PRIVATE_KEY;

  report('PUSH_PROVIDER', provider !== 'mock', provider === 'mock' ? "'mock' — set to 'fcm' to send" : provider);
  report('FCM_PROJECT_ID', haveProject, haveProject ? env.FCM_PROJECT_ID! : 'MISSING');
  report('FCM_CLIENT_EMAIL', haveEmail, haveEmail ? env.FCM_CLIENT_EMAIL! : 'MISSING');
  report('FCM_PRIVATE_KEY', haveKey, haveKey ? `${env.FCM_PRIVATE_KEY!.length} chars` : 'MISSING');
  console.log('');

  if (!haveProject || !haveEmail || !haveKey) {
    console.error(
      'Set the missing variables from your Firebase service-account JSON:\n' +
        '  Firebase console → Project settings → Service accounts → Generate new private key\n' +
        '    project_id   → FCM_PROJECT_ID\n' +
        '    client_email → FCM_CLIENT_EMAIL\n' +
        '    private_key  → FCM_PRIVATE_KEY (keep the \\n escapes)',
    );
    process.exit(1);
  }

  // The private key is the thing most often pasted wrong: Render strips or
  // mangles real newlines, so it must arrive \n-escaped and be unescaped here.
  const key = env.FCM_PRIVATE_KEY!.replace(/\\n/g, '\n');
  if (!key.includes('BEGIN PRIVATE KEY')) {
    report('key format', false, 'does not look like a PEM private key');
    console.error('  Paste the whole value including -----BEGIN PRIVATE KEY-----');
    process.exit(1);
  }
  report('key format', true, 'PEM looks well-formed');

  try {
    const { sendPush } = await import('./fcm.js');
    // An empty token list exercises the code path without sending anything.
    await sendPush([], { title: 'check', body: 'check' });
    report('FCM client', true, 'loaded and callable');
    console.log('\nCredentials look right ✓');
    console.log(
      '\nNOTE: this proves the SERVER can talk to Firebase. Notifications will\n' +
        'still not arrive until the app registers a real FCM device token —\n' +
        'it currently registers a placeholder. See DEPLOYMENT.md.',
    );
  } catch (err) {
    report('FCM client', false, err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('check failed:', e);
  process.exit(1);
});
