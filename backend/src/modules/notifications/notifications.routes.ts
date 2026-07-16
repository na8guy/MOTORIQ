import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { NotFound } from '../../lib/errors.js';
import { queryBool } from '../../lib/zod.js';

const registerBody = z.object({
  token: z.string().min(10),
  platform: z.enum(['IOS', 'ANDROID', 'WEB']).default('ANDROID'),
});

export default async function notificationsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', app.authenticate);

  // Register (or refresh) an FCM device token.
  app.post('/devices', async (req, reply) => {
    const body = registerBody.parse(req.body);
    const device = await prisma.deviceToken.upsert({
      where: { token: body.token },
      create: { userId: req.authUser.sub, token: body.token, platform: body.platform },
      update: { userId: req.authUser.sub, platform: body.platform },
    });
    reply.code(201);
    return device;
  });

  app.delete('/devices/:token', async (req, reply) => {
    const { token } = z.object({ token: z.string() }).parse(req.params);
    await prisma.deviceToken.deleteMany({ where: { token, userId: req.authUser.sub } });
    reply.code(204);
    return null;
  });

  // In-app notification inbox.
  app.get('/', async (req) => {
    const { unread } = z.object({ unread: queryBool }).parse(req.query);
    const items = await prisma.notification.findMany({
      where: { userId: req.authUser.sub, ...(unread ? { read: false } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const unreadCount = await prisma.notification.count({
      where: { userId: req.authUser.sub, read: false },
    });
    return { unreadCount, items };
  });

  app.post('/:id/read', async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const owned = await prisma.notification.findFirst({ where: { id, userId: req.authUser.sub } });
    if (!owned) throw NotFound('Notification not found');
    return prisma.notification.update({ where: { id }, data: { read: true } });
  });

  app.post('/read-all', async (req) => {
    await prisma.notification.updateMany({
      where: { userId: req.authUser.sub, read: false },
      data: { read: true },
    });
    return { ok: true };
  });
}
