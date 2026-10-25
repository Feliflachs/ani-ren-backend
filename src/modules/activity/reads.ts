import { Router } from 'express';
import type { PrismaClient, Prisma } from '@prisma/client';
import { z } from 'zod';
import type { Identity } from '../auth/auth';
import type { Catalog } from '../catalog/catalog';
import { animeDetail } from '../catalog/catalog';
import { ApiError } from '../../shared/errors';
import { animeIdSchema, resourceIdSchema } from '../../shared/validation';
import { pageFields, pageResult, readPage } from '../../shared/pagination';
import { publicationDto, publicationInclude, ratingDto, ratingInclude } from '../../shared/serializers';

export function readsRouter(db: PrismaClient, catalog: Catalog) {
  const router = Router();
  router.get('/anime', async (req, res) => {
    const query = z.object({
      q: z.string().trim().min(2).max(100),
      page: z.string().regex(/^[1-9]\d{0,3}$/).transform(Number).optional(),
    }).strict().parse(req.query);
    res.json(await catalog.search(query.q, query.page ?? 1));
  });
  router.get('/anime/:id', async (req, res) => {
    const id = animeIdSchema.parse(req.params.id);
    res.json({ anime: await animeDetail(db, catalog, id) });
  });
  router.get('/publications', async (req, res) => {
    const { userId } = res.locals.identity as Identity;
    const query = z.object({ ...pageFields, animeId: animeIdSchema.optional(),
      kind: z.enum(['review', 'post']).optional(), userId: z.string().min(1).max(100).optional() })
      .strict().parse(req.query);
    const page = readPage(query, JSON.stringify(['publications', userId, query.animeId ?? null, query.userId ?? null, query.kind ?? null]));
    const where: Prisma.PublicationWhereInput = {
      userId: query.userId, kind: query.kind,
      OR: query.animeId ? [{ ratingEntry: { animeId: query.animeId } },
        { mentions: { some: { animeId: query.animeId } } }] : undefined,
    };
    const [rows, total] = await db.$transaction([
      db.publication.findMany({ where: { ...where, id: page.before ? { lt: page.before } : undefined },
        orderBy: { id: 'desc' }, take: page.limit + 1, include: publicationInclude(userId) }),
      db.publication.count({ where }),
    ]);
    res.json(pageResult(rows, total, page, publicationDto));
  });
  router.get('/publications/:id', async (req, res) => {
    const id = resourceIdSchema.parse(req.params.id);
    const { userId } = res.locals.identity as Identity;
    const publication = await db.publication.findUnique({ where: { id }, include: publicationInclude(userId) });
    if (!publication) throw new ApiError(404, 'PUBLICATION_NOT_FOUND', 'Publicación no encontrada.');
    res.json({ publication: publicationDto(publication) });
  });
  router.get('/me/anime/:animeId/activity', async (req, res) => {
    const animeId = animeIdSchema.parse(req.params.animeId);
    const { userId } = res.locals.identity as Identity;
    const query = z.object(pageFields).strict().parse(req.query);
    const page = readPage(query, `activity:${userId}:${animeId}`);
    const where = { userId, animeId };
    const [rows, total, current, library, lists] = await db.$transaction([
      db.ratingEntry.findMany({ where: { ...where, id: page.before ? { lt: page.before } : undefined },
        orderBy: { id: 'desc' }, take: page.limit + 1, include: ratingInclude }),
      db.ratingEntry.count({ where }),
      db.ratingEntry.findFirst({ where: { ...where, currentFor: { some: { userId, animeId } } }, include: ratingInclude }),
      db.libraryEntry.findUnique({ where: { userId_animeId: where } }),
      db.animeList.findMany({ where: { userId, items: { some: { animeId } } }, select: { id: true }, orderBy: { id: 'asc' } }),
    ]);
    res.json({ ...pageResult(rows, total, page, ratingDto), watched: library?.watched ?? false,
      watchlist: library?.watchlist ?? false, favoritePosition: library?.favoritePosition ?? null,
      currentRating: current ? ratingDto(current) : null, listIds: lists.map(list => String(list.id)) });
  });
  return router;
}
