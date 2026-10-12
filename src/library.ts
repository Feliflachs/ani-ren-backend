import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { Identity } from './auth';
import { ensureAnime, type Catalog } from './catalog';
import { pageFields, pageResult, readPage } from './pagination';
import { animeIdSchema, uniqueAnimeIds } from './validation';

export function libraryRouter(db: PrismaClient, catalog: Catalog) {
  const router = Router();
  router.get('/me/library', async (req, res) => {
    const { userId } = res.locals.identity as Identity;
    const query = z.object({ ...pageFields, collection: z.enum(['watched', 'watchlist']).default('watched') })
      .strict().parse(req.query);
    const page = readPage(query, `library:${userId}:${query.collection}`);
    const where = { userId, [query.collection]: true };
    const [rows, total] = await db.$transaction([
      db.libraryEntry.findMany({ where: { ...where, id: page.before ? { lt: page.before } : undefined },
        orderBy: { id: 'desc' }, take: page.limit + 1, include: { anime: true } }),
      db.libraryEntry.count({ where }),
    ]);
    res.json(pageResult(rows, total, page, (row) => ({ anime: row.anime, watched: row.watched,
      watchlist: row.watchlist, favoritePosition: row.favoritePosition })));
  });
  router.patch('/me/library/:animeId', async (req, res) => {
    const animeId = animeIdSchema.parse(req.params.animeId);
    // Desmarcar visto continúa pendiente de su regla de producto.
    const changes = z.object({ watched: z.literal(true).optional(), watchlist: z.boolean().optional() }).strict()
      .refine((value) => Object.keys(value).length > 0, 'Indicá un cambio.').parse(req.body);
    const { userId } = res.locals.identity as Identity;
    await ensureAnime(db, catalog, animeId);
    const entry = await db.libraryEntry.upsert({
      where: { userId_animeId: { userId, animeId } },
      create: { userId, animeId, ...changes }, update: changes,
    });
    res.json({ animeId: entry.animeId, watched: entry.watched, watchlist: entry.watchlist,
      favoritePosition: entry.favoritePosition });
  });
  router.get('/me/favorites', async (_req, res) => {
    const { userId } = res.locals.identity as Identity;
    const rows = await db.libraryEntry.findMany({ where: { userId, favoritePosition: { not: null } },
      orderBy: { favoritePosition: 'asc' }, include: { anime: true } });
    res.json({ items: rows.map((row) => ({ anime: row.anime, position: row.favoritePosition })), total: rows.length });
  });
  router.put('/me/favorites', async (req, res) => {
    const { animeIds } = z.object({ animeIds: uniqueAnimeIds(100) }).strict().parse(req.body);
    const { userId } = res.locals.identity as Identity;
    for (const animeId of animeIds) await ensureAnime(db, catalog, animeId);
    const rows = await db.$transaction(async (tx) => {
      // Limpiar posiciones antes de reordenar evita conflictos del índice único.
      await tx.libraryEntry.updateMany({ where: { userId, favoritePosition: { not: null } }, data: { favoritePosition: null } });
      for (const [favoritePosition, animeId] of animeIds.entries()) {
        await tx.libraryEntry.upsert({ where: { userId_animeId: { userId, animeId } },
          create: { userId, animeId, favoritePosition }, update: { favoritePosition } });
      }
      return tx.libraryEntry.findMany({ where: { userId, favoritePosition: { not: null } },
        orderBy: { favoritePosition: 'asc' }, include: { anime: true } });
    });
    res.json({ items: rows.map((row) => ({ anime: row.anime, position: row.favoritePosition })), total: rows.length });
  });
  return router;
}
