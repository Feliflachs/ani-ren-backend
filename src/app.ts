import express from 'express';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import type { PrismaClient } from '@prisma/client';
import type { Catalog } from './catalog';
import { authRouter, requireSession } from './auth';
import { activityRouter } from './activity';
import { readsRouter } from './reads';
import { socialRouter } from './social';
import { postsRouter } from './posts';
import { libraryRouter } from './library';
import { listsRouter } from './lists';
import { searchRouter } from './search';
import { discoveryRouter } from './discovery';
import { auraRouter } from './aura';
import { ApiError, errorHandler } from './errors';
import { AniListExtras, animeExtrasRouter, type AnimeExtrasProvider } from './anime-extras';

export function createApp(options: {
  db: PrismaClient; catalog: Catalog; corsOrigins: string[]; sessionDays: number; timeZone: string;
  extras?: AnimeExtrasProvider;
}) {
  const { db, catalog } = options;
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); res.set('X-Content-Type-Options', 'nosniff'); next(); });
  app.use(cors({
    origin(origin, callback) {
      // Expo nativo y clientes HTTP no envían Origin. CORS no reemplaza autenticación.
      if (!origin || options.corsOrigins.includes(origin)) callback(null, true);
      else callback(new ApiError(403, 'ORIGIN_NOT_ALLOWED', 'Origen web no autorizado.'));
    },
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  }));
  app.use(express.json({ limit: '32kb' }));
  app.get('/api/health', async (_req, res) => {
    await db.$queryRaw`SELECT 1`;
    res.json({ ok: true });
  });
  app.use('/api/auth', authRouter(db, options.sessionDays));
  app.use('/api', requireSession(db), rateLimit({
    windowMs: 60_000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false,
    keyGenerator: (_req, res) => res.locals.identity.userId,
    message: { error: { code: 'RATE_LIMIT', message: 'Demasiadas solicitudes. Reintentá en un momento.' } },
  }));
  app.use('/api', activityRouter(db, catalog, options.timeZone));
  app.use('/api', postsRouter(db, catalog));
  app.use('/api', listsRouter(db, catalog));
  app.use('/api', searchRouter(db, catalog));
  app.use('/api', discoveryRouter(db));
  app.use('/api', auraRouter(db));
  app.use('/api', socialRouter(db));
  app.use('/api', libraryRouter(db, catalog));
  app.use('/api', readsRouter(db, catalog));
  app.use('/api', animeExtrasRouter(options.extras ?? new AniListExtras()));
  app.use((_req, _res, next) => next(new ApiError(404, 'ROUTE_NOT_FOUND', 'Ruta no encontrada.')));
  app.use(errorHandler);
  return app;
}
