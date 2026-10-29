import { Router } from 'express';
import { Prisma, type PrismaClient, type MissionClaim } from '@prisma/client';
import { z } from 'zod';
import { profileSelect, type Identity } from '../auth/auth';
import { ApiError } from '../../shared/errors';
import { pageFields } from '../../shared/pagination';
import { progressData, synchronizedProgress, claimDto } from './aura.service';
import { auraRulesVersion, rankProgress } from './aura.rules';
export { rankProgress } from './aura.rules';

export function auraRouter(db: PrismaClient) {
  const router = Router();
  router.get('/me/aura', async (req, res) => {
    z.object({}).strict().parse(req.query);
    const { userId } = res.locals.identity as Identity;
    res.json(await db.$transaction((tx) => synchronizedProgress(tx, userId)));
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
    const { userId } = res.locals.identity as Identity;
    const where = { userId_missionId: { userId, missionId } };
    let claim: MissionClaim;
    try {
      claim = await db.$transaction(async (tx) => {
        const existing = await tx.missionClaim.findUnique({ where });
        if (existing) return existing;
        const data = await progressData(tx, userId);
        const mission = data.missions.find(item => item.id === missionId);
        if (!mission) throw new ApiError(404, 'MISSION_NOT_FOUND', 'Misión no encontrada.');
        if (mission.state !== 'completed') {
          throw new ApiError(409, 'MISSION_INCOMPLETE', 'Todavía no completaste esta misión.');
        }
        return tx.missionClaim.create({ data: { userId, missionId, rewardId: mission.rewardId,
          rewardName: mission.reward, points: mission.points, rulesVersion: auraRulesVersion } });
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || !['P2002', 'P2034'].includes(error.code)) throw error;
      const existing = await db.missionClaim.findUnique({ where });
      if (!existing) throw error;
      claim = existing;
    }
    res.json({ claim: claimDto(claim), aura: await db.$transaction(tx => progressData(tx, userId)) });
  });
  router.get('/ranking', async (req, res) => {
    const query = z.object({ ...pageFields, scope: z.enum(['global', 'friends']).default('global') }).strict().parse(req.query);
    const { userId } = res.locals.identity as Identity;
    const cursorScope = JSON.stringify(['ranking', query.scope, userId]);
    let cursor: { scope: string; points: number; id: string } | undefined;
    if (query.cursor) {
      try {
        if (!/^[A-Za-z0-9_-]+$/.test(query.cursor)) throw new Error();
        cursor = z.object({ scope: z.string(), points: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
          id: z.string().min(1).max(100) }).strict().parse(JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')));
        if (cursor.scope !== cursorScope) throw new Error();
      } catch { throw new ApiError(400, 'INVALID_CURSOR', 'El cursor no corresponde a este ranking.'); }
    }
    const where: Prisma.UserWhereInput = query.scope === 'global' ? {} : { OR: [{ id: userId }, {
      followers: { some: { followerId: userId } }, following: { some: { followedId: userId } },
    }] };
    const users = await db.user.findMany({ where, select: { ...profileSelect,
      _count: { select: { library: { where: { watched: true } } } }, missionClaims: { select: { points: true } } } });
    const sorted = users.map(user => ({ ...user, points: user.missionClaims.reduce((sum, claim) => sum + claim.points, 0) })).sort((a, b) => b.points - a.points || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    let position = 0;
    const ranked = sorted.map(({ _count, missionClaims, points, ...user }, index) => {
      if (index === 0 || points !== sorted[index - 1].points) position = index + 1;
      return { user, points, watched: _count.library, position, rank: rankProgress(points) };
    });
    const current = ranked.find((row) => row.user.id === userId)!;
    const candidates = ranked.filter((row) => !cursor || row.points < cursor.points ||
      (row.points === cursor.points && row.user.id > cursor.id));
    const limit = query.limit ?? 20;
    const items = candidates.slice(0, limit);
    const last = items.at(-1);
    res.json({ scope: query.scope, metric: 'claimed_mission_points', items, total: ranked.length,
      me: { position: current.position, points: current.points, watched: current.watched, rank: current.rank },
      nextCursor: candidates.length > limit && last ? Buffer.from(JSON.stringify({ scope: cursorScope,
        points: last.points, id: last.user.id })).toString('base64url') : null });
  });
  return router;
}
