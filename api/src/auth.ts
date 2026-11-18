// Admin authentication with Amazon Cognito.
//
// On AWS: API Gateway's Cognito authorizer verifies the access token on /api/admin/* before the
// Lambda runs (the Lambda has no internet access to fetch Cognito's signing keys). The Lambda
// reads the verified claims from the API Gateway event.
//
// Locally: if COGNITO_USER_POOL_ID/COGNITO_REGION/COGNITO_CLIENT_ID are set, the token is verified
// here against Cognito's public keys. Otherwise ADMIN_DEV_BYPASS=true lets you use /admin without
// signing in. The bypass is ignored when running in Lambda.
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { FastifyReply, FastifyRequest } from 'fastify';

export const ADMIN_GROUP = 'admins';

export interface AdminIdentity { sub: string; email?: string; groups: string[] }
export type AdminVerifier = (req: FastifyRequest) => Promise<AdminIdentity | null>;

const inLambda = () => !!process.env.AWS_LAMBDA_FUNCTION_NAME;

/** API Gateway passes JWT claims as strings; arrays arrive like "[admins editors]". */
export function parseGroups(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v !== 'string' || !v.trim()) return [];
  return v.replace(/^\[|\]$/g, '').split(/[\s,]+/).filter(Boolean);
}

const toIdentity = (c: Record<string, unknown>): AdminIdentity => ({
  sub: String(c.sub ?? ''),
  email: typeof c.email === 'string' ? c.email : typeof c.username === 'string' ? c.username : undefined,
  groups: parseGroups(c['cognito:groups']),
});

type LambdaReq = { awsLambda?: { event?: { requestContext?: { authorizer?: { jwt?: { claims?: Record<string, unknown> } } } } } };

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

export const defaultVerifier: AdminVerifier = async req => {
  if (inLambda()) {
    const claims = (req as unknown as LambdaReq).awsLambda?.event?.requestContext?.authorizer?.jwt?.claims;
    if (!claims || claims.token_use !== 'access' || claims.client_id !== process.env.COGNITO_CLIENT_ID) return null;
    return toIdentity(claims);
  }

  const { COGNITO_USER_POOL_ID: pool, COGNITO_REGION: region, COGNITO_CLIENT_ID: clientId } = process.env;
  if (pool && region && clientId) {
    const h = req.headers.authorization;
    if (!h?.startsWith('Bearer ')) return null;
    const issuer = `https://cognito-idp.${region}.amazonaws.com/${pool}`;
    jwks ??= createRemoteJWKSet(new URL(issuer + '/.well-known/jwks.json'));
    try {
      const { payload } = await jwtVerify(h.slice(7), jwks, { issuer });
      const p = payload as JWTPayload & Record<string, unknown>;
      if (p.token_use !== 'access' || p.client_id !== clientId) return null;
      return toIdentity(p);
    } catch {
      return null;
    }
  }

  if (process.env.ADMIN_DEV_BYPASS === 'true') return { sub: 'dev', email: 'dev@localhost', groups: [ADMIN_GROUP] };
  return null;
};

/** What the admin page needs to know to sign in. */
export function authConfig() {
  const { COGNITO_DOMAIN: domain, COGNITO_CLIENT_ID: clientId } = process.env;
  if (domain && clientId) return { mode: 'cognito' as const, domain, clientId };
  if (!inLambda() && process.env.ADMIN_DEV_BYPASS === 'true') return { mode: 'dev' as const };
  return { mode: 'none' as const };
}

declare module 'fastify' {
  interface FastifyRequest { admin?: AdminIdentity }
}

/** Fastify preHandler: 401 without a valid token, 403 if the user isn't in the admins group. */
export const requireAdmin = (verify: AdminVerifier) => async (req: FastifyRequest, reply: FastifyReply) => {
  const id = await verify(req);
  if (!id) return reply.code(401).send({ error: 'Not signed in' });
  if (!id.groups.includes(ADMIN_GROUP)) return reply.code(403).send({ error: 'This account isn’t an admin' });
  req.admin = id;
};
