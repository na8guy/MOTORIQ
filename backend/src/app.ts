import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import { ZodError } from 'zod';
import { env } from './config/env.js';
import { AppError } from './lib/errors.js';
import authPlugin from './plugins/auth.js';

import authRoutes from './modules/auth/auth.routes.js';
import usersRoutes from './modules/users/users.routes.js';
import vehiclesRoutes from './modules/vehicles/vehicles.routes.js';
import remindersRoutes from './modules/reminders/reminders.routes.js';
import walletRoutes from './modules/wallet/wallet.routes.js';
import cardsRoutes from './modules/cards/cards.routes.js';
import subscriptionsRoutes from './modules/subscriptions/subscriptions.routes.js';
import fuelRoutes from './modules/fuel/fuel.routes.js';
import savingsRoutes from './modules/savings/savings.routes.js';
import referralsRoutes from './modules/referrals/referrals.routes.js';
import kycRoutes from './modules/kyc/kyc.routes.js';
import fraudRoutes from './modules/fraud/fraud.routes.js';
import insightsRoutes from './modules/insights/insights.routes.js';
import notificationsRoutes from './modules/notifications/notifications.routes.js';
import adminRoutes from './modules/admin/admin.routes.js';
import { ADMIN_DASHBOARD_HTML } from './modules/admin/admin.dashboard.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      transport:
        env.NODE_ENV === 'development'
          ? { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } }
          : undefined,
    },
  });

  await app.register(cors, {
    origin: env.CORS_ORIGINS === '*' ? true : env.CORS_ORIGINS.split(',').map((s) => s.trim()),
  });
  await app.register(sensible);
  await app.register(authPlugin);

  // Health check + service metadata.
  app.get('/health', async () => ({
    status: 'ok',
    service: 'motoriq-api',
    time: new Date().toISOString(),
    integrations: {
      wallester: env.WALLESTER_MOCK ? 'mock' : 'live',
      fuelFinder: env.FUEL_FINDER_MODE,
    },
  }));

  // Ops dashboard (static single-page app, same-origin to /api/v1).
  app.get('/admin', async (_req, reply) => {
    reply.type('text/html').send(ADMIN_DASHBOARD_HTML);
  });

  // Central error handler — maps app + validation errors to JSON.
  // Registered BEFORE routes so every encapsulated context inherits it.
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: error.flatten() },
      });
      return;
    }
    if (error instanceof AppError) {
      reply
        .code(error.statusCode)
        .send({ error: { code: error.code, message: error.message, details: error.details } });
      return;
    }
    request.log.error(error);
    const statusCode = (error as { statusCode?: number }).statusCode ?? 500;
    const message = error instanceof Error ? error.message : 'Internal server error';
    reply.code(statusCode >= 400 ? statusCode : 500).send({
      error: {
        code: 'INTERNAL_ERROR',
        message: env.NODE_ENV === 'production' ? 'Internal server error' : message,
      },
    });
  });

  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send({
      error: { code: 'NOT_FOUND', message: `Route ${request.method} ${request.url} not found` },
    });
  });

  // API v1 — registered after the handlers above so they are inherited.
  await app.register(
    async (v1) => {
      await v1.register(authRoutes, { prefix: '/auth' });
      await v1.register(usersRoutes, { prefix: '/users' });
      await v1.register(vehiclesRoutes, { prefix: '/vehicles' });
      await v1.register(remindersRoutes, { prefix: '/reminders' });
      await v1.register(walletRoutes, { prefix: '/wallet' });
      await v1.register(cardsRoutes, { prefix: '/cards' });
      await v1.register(subscriptionsRoutes, { prefix: '/subscriptions' });
      await v1.register(fuelRoutes, { prefix: '/fuel' });
      await v1.register(savingsRoutes, { prefix: '/savings' });
      await v1.register(referralsRoutes, { prefix: '/referrals' });
      await v1.register(kycRoutes, { prefix: '/kyc' });
      await v1.register(fraudRoutes, { prefix: '/fraud' });
      await v1.register(insightsRoutes, { prefix: '/insights' });
      await v1.register(notificationsRoutes, { prefix: '/notifications' });
      await v1.register(adminRoutes, { prefix: '/admin' });
    },
    { prefix: '/api/v1' },
  );

  return app;
}
