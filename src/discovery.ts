import { Router } from 'express';
import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { Identity } from './auth';
import { ApiError } from './errors';
import { pageFields } from './pagination';
import { genresOf } from './search';
import { publicationDto, publicationInclude } from './serializers';
import { extractTags, normalizeTag } from './validation';
import { animeDiscoveryRouter } from './anime-discovery';

// Para ti reúne conversaciones; vistos y seguidos también pueden ser relevantes.
function eligible(userId: string): Prisma.PublicationWhereInput {
  return { userId: { not: userId } };
}

async function createSelection(tx: Prisma.TransactionClient, userId: string) {
  const library = await tx.libraryEntry.findMany({ where: { userId }, select: {
    animeId: true, watched: true, watchlist: true, favoritePosition: true, anime: { select: { genres: true } },
  } });
  const watchlist = new Set(library.filter((row) => row.watchlist && !row.watched).map((row) => row.animeId));
  const interests = new Set(library.filter((row) => row.watched || row.watchlist || row.favoritePosition !== null)
    .flatMap((row) => genresOf(row.anime.genres).map((genre) => normalizeTag(genre.name))));
  const likes = await tx.publicationLike.findMany({ where: { userId }, select: { publication: { select: { text: true } } } });
  const likedTags = new Set(likes.flatMap((like) => extractTags(like.publication.text)));
  // Se puntúa el conjunto completo antes de paginar, no solo los últimos 20.
  // Selección local inicial para la comunidad pequeña; no consulta Jikan.
  const candidates = await tx.publication.findMany({ where: eligible(userId), select: {
    id: true, userId: true, text: true,
    ratingEntry: { select: { anime: { select: { id: true, genres: true } } } },
    mentions: { select: { anime: { select: { id: true, genres: true } } } },
  } });
  const ranked = candidates.map((row) => {
    const anime = row.ratingEntry ? [row.ratingEntry.anime] : row.mentions.map((mention) => mention.anime);
    const genreNames = [...new Set(anime.flatMap((item) => genresOf(item.genres).map((genre) => normalizeTag(genre.name))))];
    const matchedGenres = genreNames.filter((genre) => interests.has(genre)).sort();
    const matchedTags = extractTags(row.text).filter((tag) => interests.has(tag) || likedTags.has(tag)).sort();
    const inWatchlist = anime.some((item) => watchlist.has(item.id));
    return { id: row.id, userId: row.userId, score: (inWatchlist ? 3 : 0) + matchedGenres.length + matchedTags.length,
      reasons: { inWatchlist, matchedGenres, matchedTags } };
  }).sort((a, b) => b.score - a.score || b.id - a.id);

  // Alternar autores sobre el orden global. No descartar sus otras reviews.
  const selected: typeof ranked = [];
  while (ranked.length) {
    const index = ranked.findIndex((row) => row.userId !== selected.at(-1)?.userId);
    selected.push(ranked.splice(index < 0 ? 0 : index, 1)[0]);
  }
  const now = new Date();
  await tx.feedSnapshot.deleteMany({ where: { OR: [{ userId }, { expiresAt: { lte: now } }] } });
  const snapshot = await tx.feedSnapshot.create({ data: { userId, expiresAt: new Date(now.getTime() + 20 * 60_000) } });
  // Lotes acotados para no superar los parámetros de una sentencia SQLite.
  for (let start = 0; start < selected.length; start += 100) {
    await tx.feedItem.createMany({ data: selected.slice(start, start + 100).map((row, index) => ({
      snapshotId: snapshot.id, publicationId: row.id, position: start + index, score: row.score, reasons: row.reasons,
    })) });
  }
  return snapshot;
}

export function discoveryRouter(db: PrismaClient) {
  const router = Router();
  router.use(animeDiscoveryRouter(db));
  router.get('/feed', async (req, res, next) => {
    if (req.query.type !== 'for-you') { next(); return; }
    const query = z.object({ ...pageFields, type: z.literal('for-you') }).strict().parse(req.query);
    const { userId } = res.locals.identity as Identity;
    let cursor: { snapshotId: string; after: number } | undefined;
    if (query.cursor) {
      try {
        if (!/^[A-Za-z0-9_-]+$/.test(query.cursor)) throw new Error();
        cursor = z.object({ snapshotId: z.string().min(1).max(100), after: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) })
          .strict().parse(JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')));
      } catch { throw new ApiError(400, 'INVALID_CURSOR', 'El cursor no corresponde a Para ti.'); }
    }
    const result = await db.$transaction(async (tx) => {
      const snapshot = cursor ? await tx.feedSnapshot.findUnique({ where: { id: cursor.snapshotId } }) : await createSelection(tx, userId);
      if (snapshot && snapshot.userId !== userId) throw new ApiError(400, 'INVALID_CURSOR', 'El cursor no corresponde a esta cuenta.');
      if (!snapshot || snapshot.expiresAt <= new Date()) {
        throw new ApiError(410, 'FEED_EXPIRED', 'La selección venció o fue renovada. Volvé a cargar Para ti desde el inicio.');
      }
      const limit = query.limit ?? 20;
      const where: Prisma.FeedItemWhereInput = { snapshotId: snapshot.id, publication: eligible(userId) };
      const rows = await tx.feedItem.findMany({ where: { ...where, position: { gt: cursor?.after ?? -1 } },
        orderBy: { position: 'asc' }, take: limit + 1, include: { publication: { include: publicationInclude(userId) } } });
      const total = await tx.feedItem.count({ where });
      const watched = new Set((await tx.libraryEntry.findMany({ where: { userId, watched: true }, select: { animeId: true } })).map((row) => row.animeId));
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      return { items: page.map((row) => {
        const publication = publicationDto(row.publication);
        return { ...publication, recommendation: { score: row.score, reasons: row.reasons,
          discoveryAnimeIds: publication.animeIds.filter((id) => !watched.has(id)) } };
      }), total, nextCursor: rows.length > limit && last
        ? Buffer.from(JSON.stringify({ snapshotId: snapshot.id, after: last.position })).toString('base64url') : null,
      generatedAt: snapshot.createdAt.toISOString(), expiresAt: snapshot.expiresAt.toISOString() };
    }, { timeout: 15_000 });
    res.json(result);
  });
  return router;
}
