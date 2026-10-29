import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { Identity } from '../auth/auth';
import { ApiError } from '../../shared/errors';
import { pageFields } from '../../shared/pagination';
import { selectionPage } from '../../shared/selection';
import { normalizeText } from '../search/search';

export function libraryQueriesRouter(db: PrismaClient) {
  const router = Router();
  router.get('/users/:id/library', async (req, res) => {
    const id = z.string().min(1).max(100).parse(req.params.id);
    const query = z.object({ ...pageFields, collection: z.enum(['watched', 'watchlist', 'favorites']).default('watched'),
      q: z.string().trim().max(100).default('') }).strict().parse(req.query);
    const { userId } = res.locals.identity as Identity;
    if (!await db.user.findUnique({ where: { id }, select: { id: true } })) throw new ApiError(404, 'USER_NOT_FOUND', 'Usuario no encontrado.');
    const term = normalizeText(query.q);
    res.json(await selectionPage(db, userId, JSON.stringify(['library', id, query.collection, term]), query, async tx => {
      const rows = await tx.libraryEntry.findMany({ where: { userId: id,
        ...(query.collection === 'favorites' ? { favoritePosition: { not: null } } : { [query.collection]: true }) },
        orderBy: query.collection === 'favorites' ? { favoritePosition: 'asc' } : { id: 'desc' }, include: { anime: true } });
      return rows.filter(row => normalizeText(row.anime.title + ' ' + (row.anime.japanese ?? '')).includes(term))
        .map(row => ({ anime: row.anime, watched: row.watched, watchlist: row.watchlist, favoritePosition: row.favoritePosition }));
    }));
  });
  return router;
}
