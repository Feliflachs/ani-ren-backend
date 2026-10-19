import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { Identity } from './auth';
import { ApiError } from './errors';
import { pageFields } from './pagination';
import { genresOf } from './search';
import { normalizeTag } from './validation';
import { publicationDto, publicationInclude } from './serializers';

// Catálogo guardado en Ani-Ren: no descarga el proveedor ni hace consultas por tarjeta.
export function animeDiscoveryRouter(db: PrismaClient) {
  const router = Router();
  router.get('/discover', async (req, res) => {
    const query = z.object(pageFields).strict().parse(req.query);
    const { userId } = res.locals.identity as Identity;
    let cursor: { snapshotId: string; after: number } | undefined;
    if (query.cursor) {
      try {
        if (!/^[A-Za-z0-9_-]+$/.test(query.cursor)) throw new Error();
        cursor = z.object({ kind: z.literal('discover'), snapshotId: z.string().min(1).max(100), after: z.number().int().nonnegative() })
          .strict().parse(JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')));
      } catch { throw new ApiError(400, 'INVALID_CURSOR', 'El cursor no corresponde a Descubrir.'); }
    }
    const result = await db.$transaction(async (tx) => {
      const library = await tx.libraryEntry.findMany({ where: { userId }, include: { anime: true } });
      const watched = new Set(library.filter((row) => row.watched).map((row) => row.animeId));
      const watchlist = new Set(library.filter((row) => row.watchlist).map((row) => row.animeId));
      let snapshot;
      if (cursor) {
        snapshot = await tx.discoverySnapshot.findUnique({ where: { id: cursor.snapshotId } });
        if (snapshot && snapshot.userId !== userId) throw new ApiError(400, 'INVALID_CURSOR', 'El cursor no corresponde a esta cuenta.');
        if (!snapshot || snapshot.expiresAt <= new Date()) throw new ApiError(410, 'DISCOVERY_EXPIRED', 'La selección venció. Volvé a cargar Descubrir.');
      } else {
        const interests = new Set(library.filter((row) => row.watched || row.watchlist || row.favoritePosition !== null)
          .flatMap((row) => genresOf(row.anime.genres).map((genre) => normalizeTag(genre.name))));
        const candidates = await tx.anime.findMany({ where: { library: { none: { userId, watched: true } } },
          select: { id: true, externalId: true, genres: true } });
        const ids = candidates.map((anime) => ({ ...anime,
          score: genresOf(anime.genres).filter((genre) => interests.has(normalizeTag(genre.name))).length,
        })).sort((a, b) => b.score - a.score || b.externalId - a.externalId).map((anime) => anime.id);
        await tx.discoverySnapshot.deleteMany({ where: { OR: [{ userId }, { expiresAt: { lte: new Date() } }] } });
        snapshot = await tx.discoverySnapshot.create({ data: { userId, animeIds: ids, expiresAt: new Date(Date.now() + 20 * 60_000) } });
      }
      const ids = z.array(z.string()).parse(snapshot.animeIds);
      const eligible = ids.map((id, position) => ({ id, position })).filter((row) => !watched.has(row.id));
      const remaining = eligible.filter((row) => row.position > (cursor?.after ?? -1));
      const selected = remaining.slice(0, query.limit ?? 20);
      const selectedIds = selected.map((row) => row.id);
      const [anime, ratings, counts, reviews] = await Promise.all([
        tx.anime.findMany({ where: { id: { in: selectedIds } } }),
        tx.ratingEntry.groupBy({ by: ['animeId'], where: { animeId: { in: selectedIds }, currentFor: { some: {} } }, _avg: { rating: true }, _count: true }),
        tx.ratingEntry.groupBy({ by: ['animeId'], where: { animeId: { in: selectedIds } }, _count: true }),
        tx.publication.findMany({ where: { kind: 'review', ratingEntry: { animeId: { in: selectedIds } } },
          orderBy: [{ likes: { _count: 'desc' } }, { id: 'desc' }], include: publicationInclude(userId) }),
      ]);
      const items = selected.flatMap(({ id }) => {
        const item = anime.find((row) => row.id === id);
        if (!item) return [];
        const votes = ratings.find((row) => row.animeId === id);
        const allReviews = reviews.filter((row) => row.ratingEntry?.animeId === id);
        const authors = new Set<string>();
        const featured = allReviews.filter((row) => {
          if (authors.has(row.userId)) return false;
          authors.add(row.userId); return true;
        }).slice(0, 2);
        return [{ id, anime: { ...item, statistics: {
          averageRating: votes?._avg.rating ?? null, ratingUserCount: votes?._count ?? 0,
          ratingCount: counts.find((row) => row.animeId === id)?._count ?? 0, reviewCount: allReviews.length,
        } }, watchlist: watchlist.has(id), reviews: featured.map(publicationDto) }];
      });
      const last = selected.at(-1);
      return { items, total: eligible.length, nextCursor: remaining.length > selected.length && last
        ? Buffer.from(JSON.stringify({ kind: 'discover', snapshotId: snapshot.id, after: last.position })).toString('base64url') : null };
    }, { timeout: 15_000 });
    res.json(result);
  });
  return router;
}
