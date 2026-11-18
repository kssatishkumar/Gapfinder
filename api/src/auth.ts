import { createHash, timingSafeEqual } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { getConfig } from './config';

const key = async () => {
  const { jwtSecret } = await getConfig();
  if (jwtSecret.length < 32) throw new Error('JWT secret is not configured');
  return new TextEncoder().encode(jwtSecret);
};
const sha = (s: string) => createHash('sha256').update(s).digest();

export async function checkPassword(given: string): Promise<boolean> {
  const { adminPassword } = await getConfig();
  if (!adminPassword) return false;
  return timingSafeEqual(sha(given), sha(adminPassword));
}

export async function issueToken(): Promise<string> {
  return new SignJWT({ role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('12h')
    .sign(await key());
}

/** Fastify preHandler: rejects requests without a valid admin bearer token. */
export async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  const h = req.headers.authorization;
  const token = h?.startsWith('Bearer ') ? h.slice(7) : '';
  try {
    const { payload } = await jwtVerify(token, await key(), { algorithms: ['HS256'] });
    if (payload.role !== 'admin') throw new Error('bad role');
  } catch {
    return reply.code(401).send({ error: 'Not signed in' });
  }
}
