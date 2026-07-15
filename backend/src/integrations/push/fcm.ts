import crypto from 'node:crypto';
import { request } from 'undici';
import { env } from '../../config/env.js';

/**
 * Firebase Cloud Messaging (HTTP v1) sender.
 *
 * Authenticates with a service account: signs a JWT (RS256), exchanges it for
 * an OAuth access token, then POSTs to the FCM send endpoint. The access token
 * is cached until shortly before expiry.
 *
 * When PUSH_PROVIDER=mock (default) it logs instead of sending, so the whole
 * notification pipeline works without Firebase credentials.
 */

export interface PushMessage {
  title: string;
  body: string;
  data?: Record<string, string>;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) return cachedToken.token;

  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = base64url(
    JSON.stringify({
      iss: env.FCM_CLIENT_EMAIL,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    }),
  );
  const unsigned = `${header}.${claim}`;
  const key = (env.FCM_PRIVATE_KEY ?? '').replace(/\\n/g, '\n');
  const signature = crypto.createSign('RSA-SHA256').update(unsigned).sign(key, 'base64url');
  const assertion = `${unsigned}.${signature}`;

  const res = await request('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString(),
  });
  const json = (await res.body.json()) as { access_token: string; expires_in: number };
  cachedToken = { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return json.access_token;
}

/** Send a push to each token. Returns tokens that FCM reported as invalid. */
export async function sendPush(tokens: string[], message: PushMessage): Promise<string[]> {
  if (tokens.length === 0) return [];

  if (env.PUSH_PROVIDER === 'mock' || !env.FCM_PROJECT_ID) {
    // eslint-disable-next-line no-console
    console.log(`[push:mock] → ${tokens.length} device(s): ${message.title} — ${message.body}`);
    return [];
  }

  const accessToken = await getAccessToken();
  const invalid: string[] = [];

  await Promise.all(
    tokens.map(async (token) => {
      try {
        const res = await request(
          `https://fcm.googleapis.com/v1/projects/${env.FCM_PROJECT_ID}/messages:send`,
          {
            method: 'POST',
            headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
            body: JSON.stringify({
              message: {
                token,
                notification: { title: message.title, body: message.body },
                data: message.data ?? {},
              },
            }),
          },
        );
        // 404 (UNREGISTERED) / 400 (invalid token) → prune it.
        if (res.statusCode === 404 || res.statusCode === 400) invalid.push(token);
      } catch {
        /* transient — leave the token in place */
      }
    }),
  );

  return invalid;
}

function base64url(input: string): string {
  return Buffer.from(input).toString('base64url');
}
