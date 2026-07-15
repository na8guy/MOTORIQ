import { prisma } from '../../lib/prisma.js';
import { sendPush } from '../../integrations/push/fcm.js';

/**
 * Create an in-app notification for a user and fan it out to their registered
 * devices via push. Invalid tokens reported by FCM are pruned.
 */
export async function notify(
  userId: string,
  input: { title: string; body: string; type?: string; data?: Record<string, string> },
): Promise<void> {
  await prisma.notification.create({
    data: {
      userId,
      title: input.title,
      body: input.body,
      type: input.type ?? 'GENERAL',
      data: input.data ?? undefined,
    },
  });

  const tokens = await prisma.deviceToken.findMany({ where: { userId } });
  if (tokens.length === 0) return;

  const invalid = await sendPush(
    tokens.map((t) => t.token),
    { title: input.title, body: input.body, data: input.data },
  );

  if (invalid.length > 0) {
    await prisma.deviceToken.deleteMany({ where: { token: { in: invalid } } });
  }
}
