import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import fastifyJwt from '@fastify/jwt';
import { env } from '../config/env.js';
import { Unauthorized } from '../lib/errors.js';

export interface AuthUser {
  sub: string; // user id
  email: string;
  tier: string;
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    authUser: AuthUser;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AuthUser;
    user: AuthUser;
  }
}

/**
 * Registers JWT signing/verification and an `authenticate` guard that
 * populates `request.authUser` for protected routes.
 */
export default fp(async (app) => {
  await app.register(fastifyJwt, {
    secret: env.JWT_SECRET,
    sign: { expiresIn: env.JWT_ACCESS_TTL },
  });

  app.decorate('authenticate', async (request: FastifyRequest, _reply: FastifyReply) => {
    try {
      await request.jwtVerify();
      request.authUser = request.user;
    } catch {
      throw Unauthorized('Missing or invalid access token');
    }
  });
});
