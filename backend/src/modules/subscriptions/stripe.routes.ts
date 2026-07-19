import type { FastifyInstance } from 'fastify';
import { env } from '../../config/env.js';
import { stripe } from '../../integrations/stripe/stripe.client.js';
import { handleStripeEvent } from './subscription.service.js';

/**
 * Stripe webhooks — the ONLY thing that grants a paid membership.
 *
 * Everything about this endpoint is shaped by one fact: it is public, and it
 * decides who gets paid features. So:
 *
 *  • The signature is verified against the RAW body. Fastify parses JSON by
 *    default, and re-serialising changes the bytes, which changes the
 *    signature, which fails every event. Hence the custom raw parser below.
 *
 *  • Without STRIPE_WEBHOOK_SECRET we reject everything with a 503 rather than
 *    processing unverified events. An unverified webhook would let anyone POST
 *    "subscription active" and grant themselves Pro for free — the exact hole
 *    the signature exists to close.
 *
 *  • Handler failures return 500 ON PURPOSE, so Stripe retries. Swallowing an
 *    error here means a member pays and never receives their tier.
 */
export default async function stripeRoutes(app: FastifyInstance): Promise<void> {
  // Keep the raw bytes for this route only; the rest of the API keeps normal
  // JSON parsing.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (_req, body, done) => done(null, body),
  );

  app.post('/webhook', async (req, reply) => {
    if (!env.STRIPE_WEBHOOK_SECRET) {
      console.error('[stripe] webhook received but STRIPE_WEBHOOK_SECRET is unset — rejecting');
      return reply.code(503).send({
        error: {
          code: 'WEBHOOK_NOT_CONFIGURED',
          message: 'Stripe webhooks are not configured on this deployment',
        },
      });
    }

    const signature = req.headers['stripe-signature'];
    if (typeof signature !== 'string') {
      return reply.code(400).send({ error: { code: 'NO_SIGNATURE', message: 'Missing stripe-signature' } });
    }

    let event;
    try {
      event = stripe.constructEvent(req.body as Buffer, signature);
    } catch (err) {
      // A bad signature is either a misconfigured secret or someone probing.
      // Either way: refuse, and never process the payload.
      console.error('[stripe] signature verification FAILED:', err instanceof Error ? err.message : err);
      return reply.code(400).send({ error: { code: 'BAD_SIGNATURE', message: 'Invalid signature' } });
    }

    try {
      // Stripe's Event type is a union of every event shape it can send; our
      // handler only cares about type + data.object, and narrows internally.
      const { handled } = await handleStripeEvent(
        event as unknown as { type: string; data: { object: Record<string, unknown> } },
      );
      console.log(`[stripe] ${event.type} ${handled ? 'handled' : 'ignored'}`);
      // 200 for ignored events too — an error would make Stripe retry forever
      // for event types we never subscribed to.
      return reply.send({ received: true, handled });
    } catch (err) {
      // Deliberately a 500: Stripe retries with backoff, which is exactly what
      // we want if the database was briefly unavailable while someone paid.
      console.error(`[stripe] handler failed for ${event.type}:`, err);
      return reply.code(500).send({ error: { code: 'HANDLER_FAILED', message: 'Retry' } });
    }
  });
}
