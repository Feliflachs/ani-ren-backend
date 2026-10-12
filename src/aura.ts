import { Router } from 'express';
import { Prisma, type PrismaClient, type MissionClaim } from '@prisma/client';
import { z } from 'zod';
import { profileSelect, type Identity } from './auth';
import { ApiError } from './errors';
import { pageFields } from './pagination';
import { genresOf } from './search';
import { normalizeTag } from './validation';

export const auraRulesVersion = '1';
// Reglas iniciales confirmadas el 12/10/2026. Cambiarlas no vuelve a habilitar
// un reclamo anterior: una misión nueva necesita una identidad diferente.
export const missionDefinitions = [
  { id: 'romance', title: 'Amante del Romance', description: 'Mirá 2 animes del género Romance.', metric: 'romance', total: 2,
    rewardId: 'corazon-de-anime', reward: 'Corazón de anime', icon: 'heart-outline' },
  { id: 'shonen', title: 'La vida es un shonen', description: 'Mirá 3 animes del género Acción.', metric: 'action', total: 3,
    rewardId: 'espiritu-shonen', reward: 'Espíritu shonen', icon: 'flash-outline' },
  { id: 'generos', title: 'Explorador de géneros', description: 'Mirá 4 géneros diferentes.', metric: 'genres', total: 4,
    rewardId: 'explorador', reward: 'Explorador', icon: 'compass-outline' },
  { id: 'reviews', title: 'Una nueva voz', description: 'Escribí 3 reviews.', metric: 'reviews', total: 3,
    rewardId: 'voz-de-la-comunidad', reward: 'Voz de la comunidad', icon: 'chatbox-outline' },
  { id: 'primera', title: 'Primera historia', description: 'Marcá tu primer anime como visto.', metric: 'watched', total: 1,
    rewardId: 'primer-capitulo', reward: 'Primer capítulo', icon: 'ribbon-outline' },
] as const;
export const ranks = ['Novato', 'Aprendiz', 'Experto', 'Maestro', 'Leyenda'] as const;
export function rankProgress(watched: number) {
  const index = Math.min(ranks.length - 1, Math.floor(watched / 100));
  const nextThreshold = index < ranks.length - 1 ? (index + 1) * 100 : null;
  return { name: ranks[index], index, watched, threshold: index * 100, nextRank: ranks[index + 1] ?? null,
    nextThreshold, remaining: nextThreshold === null ? 0 : nextThreshold - watched,
    progress: nextThreshold === null ? 1 : (watched - index * 100) / 100 };
}
const claimDto = (claim: MissionClaim) => ({ missionId: claim.missionId, rewardId: claim.rewardId,
  reward: claim.rewardName, rulesVersion: claim.rulesVersion, claimedAt: claim.claimedAt.toISOString() });

async function progressData(tx: Prisma.TransactionClient, userId: string) {
  const library = await tx.libraryEntry.findMany({ where: { userId }, select: {
    watched: true, watchlist: true, favoritePosition: true, anime: { select: { genres: true } },
  } });
  const reviews = await tx.publication.count({ where: { userId, kind: 'review' } });
  const claims = await tx.missionClaim.findMany({ where: { userId }, orderBy: { missionId: 'asc' } });
  // LibraryEntry ya es única por usuario/anime. No contar RatingEntry aquí.
  const watched = library.filter((entry) => entry.watched);
  const genreSets = watched.map((entry) => genresOf(entry.anime.genres));
  const metrics = {
    watched: watched.length, reviews,
    genres: new Set(genreSets.flatMap((genres) => genres.map((genre) => genre.id))).size,
    romance: genreSets.filter((genres) => genres.some((genre) => normalizeTag(genre.name) === 'romance')).length,
    // La misión se llama shonen en el front pero su objetivo es Acción, no la demografía Shounen.
    action: genreSets.filter((genres) => genres.some((genre) => ['action', 'accion'].includes(normalizeTag(genre.name)))).length,
  };
  const missions = missionDefinitions.map((mission) => {
    const rawProgress = metrics[mission.metric];
    const claim = claims.find((item) => item.missionId === mission.id);
    return { ...mission, rawProgress, value: Math.min(rawProgress, mission.total),
      state: rawProgress >= mission.total ? 'completed' : rawProgress > 0 ? 'in_progress' : 'pending',
      claimed: !!claim, claimedAt: claim?.claimedAt.toISOString() ?? null };
  });
  return { rulesVersion: auraRulesVersion, statistics: { watched: metrics.watched, reviews, genres: metrics.genres,
    watchlist: library.filter((entry) => entry.watchlist).length,
    favorites: library.filter((entry) => entry.favoritePosition !== null).length },
    rank: rankProgress(metrics.watched),
    ranks: ranks.map((name, index) => ({ name, index, threshold: index * 100, unlocked: metrics.watched >= index * 100 })),
    missions, rewards: claims.map(claimDto) };
}

export function auraRouter(db: PrismaClient) {
  const router = Router();
  router.get('/me/aura', async (req, res) => {
    z.object({}).strict().parse(req.query);
    const { userId } = res.locals.identity as Identity;
    res.json(await db.$transaction((tx) => progressData(tx, userId)));
  });
  router.get('/me/missions', async (req, res) => {
    z.object({}).strict().parse(req.query);
    const { userId } = res.locals.identity as Identity;
    const data = await db.$transaction((tx) => progressData(tx, userId));
    res.json({ rulesVersion: data.rulesVersion, items: data.missions, total: data.missions.length,
      claimedIds: data.rewards.map((reward) => reward.missionId) });
  });
  router.put('/me/missions/:id/claim', async (req, res) => {
    z.object({}).strict().parse(req.body ?? {});
    const missionId = z.string().min(1).max(50).parse(req.params.id);
    const mission = missionDefinitions.find((item) => item.id === missionId);
    if (!mission) throw new ApiError(404, 'MISSION_NOT_FOUND', 'Misión no encontrada.');
    const { userId } = res.locals.identity as Identity;
    const where = { userId_missionId: { userId, missionId } };
    let claim: MissionClaim;
    try {
      claim = await db.$transaction(async (tx) => {
        const existing = await tx.missionClaim.findUnique({ where });
        if (existing) return existing;
        const data = await progressData(tx, userId);
        if (data.missions.find((item) => item.id === missionId)?.state !== 'completed') {
          throw new ApiError(409, 'MISSION_INCOMPLETE', 'Todavía no completaste esta misión.');
        }
        return tx.missionClaim.create({ data: { userId, missionId, rewardId: mission.rewardId,
          rewardName: mission.reward, rulesVersion: auraRulesVersion } });
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || !['P2002', 'P2034'].includes(error.code)) throw error;
      const existing = await db.missionClaim.findUnique({ where });
      if (!existing) throw error;
      claim = existing;
    }
    res.json({ claim: claimDto(claim) });
  });
  router.get('/ranking', async (req, res) => {
    const query = z.object({ ...pageFields, scope: z.enum(['global', 'friends']).default('global') }).strict().parse(req.query);
    const { userId } = res.locals.identity as Identity;
    const cursorScope = JSON.stringify(['ranking', query.scope, userId]);
    let cursor: { scope: string; watched: number; id: string } | undefined;
    if (query.cursor) {
      try {
        if (!/^[A-Za-z0-9_-]+$/.test(query.cursor)) throw new Error();
        cursor = z.object({ scope: z.string(), watched: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
          id: z.string().min(1).max(100) }).strict().parse(JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')));
        if (cursor.scope !== cursorScope) throw new Error();
      } catch { throw new ApiError(400, 'INVALID_CURSOR', 'El cursor no corresponde a este ranking.'); }
    }
    const where: Prisma.UserWhereInput = query.scope === 'global' ? {} : { OR: [{ id: userId }, {
      followers: { some: { followerId: userId } }, following: { some: { followedId: userId } },
    }] };
    const users = await db.user.findMany({ where, select: { ...profileSelect,
      _count: { select: { library: { where: { watched: true } } } } } });
    const sorted = users.sort((a, b) => b._count.library - a._count.library || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    let position = 0;
    const ranked = sorted.map(({ _count, ...user }, index) => {
      if (index === 0 || _count.library !== sorted[index - 1]._count.library) position = index + 1;
      return { user, watched: _count.library, position, rank: rankProgress(_count.library) };
    });
    const current = ranked.find((row) => row.user.id === userId)!;
    const candidates = ranked.filter((row) => !cursor || row.watched < cursor.watched ||
      (row.watched === cursor.watched && row.user.id > cursor.id));
    const limit = query.limit ?? 20;
    const items = candidates.slice(0, limit);
    const last = items.at(-1);
    res.json({ scope: query.scope, metric: 'distinct_watched_anime', items, total: ranked.length,
      me: { position: current.position, watched: current.watched, rank: current.rank },
      nextCursor: candidates.length > limit && last ? Buffer.from(JSON.stringify({ scope: cursorScope,
        watched: last.watched, id: last.user.id })).toString('base64url') : null });
  });
  return router;
}
