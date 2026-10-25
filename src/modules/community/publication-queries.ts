import { normalizeText } from '../search/search';
import { Router } from 'express';
import type { PrismaClient, Prisma } from '@prisma/client';
import { z } from 'zod';
import type { Identity } from '../auth/auth';
import { ApiError } from '../../shared/errors';
import { pageFields } from '../../shared/pagination';
import { selectionPage } from '../../shared/selection';
import { publicationDto, publicationInclude } from '../../shared/serializers';

export function publicationQueriesRouter(db: PrismaClient) {
  const router = Router();
  router.get('/feed', async (req, res, next) => {
    if (req.query.type !== 'trending') { next(); return; }
    const query = z.object({ ...pageFields, type: z.literal('trending') }).strict().parse(req.query);
    const { userId } = res.locals.identity as Identity;
    res.json(await selectionPage(db, userId, 'feed:trending', query, async tx => {
      const rows = await tx.publication.findMany({ include: publicationInclude(userId) });
      return rows.sort((a, b) => (b._count.likes + b._count.comments) - (a._count.likes + a._count.comments)
        || b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id).map(publicationDto);
    }));
  });
  router.get('/users/:id/publications', async (req, res) => {
    const id = z.string().min(1).max(100).parse(req.params.id);
    const query = z.object({ ...pageFields, collection: z.enum(['reviews', 'posts', 'likes', 'all']).default('all'),
      q: z.string().trim().max(100).default(''), sort: z.enum(['recent', 'featured']).default('recent') }).strict().parse(req.query);
    const { userId } = res.locals.identity as Identity;
    if (!await db.user.findUnique({ where: { id }, select: { id: true } })) throw new ApiError(404, 'USER_NOT_FOUND', 'Usuario no encontrado.');
    res.json(await selectionPage(db, userId, JSON.stringify(['profile-publications', id, query.collection, query.sort, normalizeText(query.q)]), query, async tx => {
      const where: Prisma.PublicationWhereInput = query.collection === 'likes' ? { likes: { some: { userId: id } } }
        : { userId: id, kind: query.collection === 'reviews' ? 'review' : query.collection === 'posts' ? 'post' : undefined };
      const rows = await tx.publication.findMany({ where, include: publicationInclude(userId) });
      return rows.sort((a, b) => (query.sort === 'featured'
        ? b._count.likes + b._count.comments - a._count.likes - a._count.comments : 0)
        || b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id).map(publicationDto)
        .filter(row => normalizeText([row.text,row.title,row.anime?.title,...row.mentionedAnime.map(anime=>anime.title)].join(' ')).includes(normalizeText(query.q)));
    }));
  });
  return router;
}
