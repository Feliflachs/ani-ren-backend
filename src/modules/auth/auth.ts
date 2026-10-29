import { Router, type RequestHandler } from 'express';
import type { PrismaClient } from '@prisma/client';
import { rateLimit } from 'express-rate-limit';
import { ApiError } from '../../shared/errors';
import { credentialsSchema } from '../../shared/validation';
import { hashPassword, hashToken, newToken, verifyPassword } from './security';

export const profileSelect = { id: true, handle: true, name: true, bio: true, avatarUrl: true, avatarId: true, createdAt: true } as const;
export type Identity = { userId: string; tokenHash: string };

export function requireSession(db: PrismaClient): RequestHandler {
  return async (req, res, next) => {
    const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.get('Authorization') ?? '');
    if (!match) throw new ApiError(401, 'SESSION_REQUIRED', 'Iniciá sesión para continuar.');
    const tokenHash = hashToken(match[1]);
    const session = await db.session.findUnique({ where: { tokenHash } });
    if (!session || session.expiresAt <= new Date()) {
      throw new ApiError(401, 'SESSION_EXPIRED', 'La sesión venció o fue cerrada.');
    }
    res.locals.identity = { userId: session.userId, tokenHash } satisfies Identity;
    next();
  };
}

export function authRouter(db: PrismaClient, sessionDays: number) {
  const router = Router();
  const throttle = rateLimit({
    windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: { code: 'AUTH_RATE_LIMIT', message: 'Demasiados intentos. Reintentá más tarde.' } },
  });
  router.post('/register', throttle, async (req, res) => {
    const { handle, password } = credentialsSchema.parse(req.body);
    const normalizedHandle = handle.toLowerCase();
    const passwordHash = await hashPassword(password);
    const user = await db.user.create({
      data: { handle, normalizedHandle, passwordHash, name: handle }, select: profileSelect,
    });
    res.status(201).json({ user });
  });
  router.post('/login', throttle, async (req, res) => {
    const { handle, password } = credentialsSchema.parse(req.body);
    const account = await db.user.findUnique({ where: { normalizedHandle: handle.toLowerCase() } });
    // Ejecutar un hash aun si la cuenta no existe; el mensaje tampoco revela el caso.
    const valid = account ? await verifyPassword(password, account.passwordHash) :
      (await hashPassword(password), false);
    if (!account || !valid) throw new ApiError(401, 'INVALID_CREDENTIALS', 'Usuario o contraseña incorrectos.');
    const token = newToken();
    const expiresAt = new Date(Date.now() + sessionDays * 24 * 60 * 60 * 1000);
    await db.$transaction([
      db.session.deleteMany({ where: { userId: account.id, expiresAt: { lte: new Date() } } }),
      db.session.create({ data: { userId: account.id, tokenHash: hashToken(token), expiresAt } }),
    ]);
    const user = await db.user.findUniqueOrThrow({ where: { id: account.id }, select: profileSelect });
    res.json({ user, token, expiresAt });
  });
  router.get('/me', requireSession(db), async (_req, res) => {
    const { userId } = res.locals.identity as Identity;
    res.json({ user: await db.user.findUniqueOrThrow({ where: { id: userId }, select: profileSelect }) });
  });
  router.post('/logout', requireSession(db), async (_req, res) => {
    const { tokenHash } = res.locals.identity as Identity;
    await db.session.deleteMany({ where: { tokenHash } });
    res.sendStatus(204);
  });
  return router;
}
