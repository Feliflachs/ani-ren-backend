import type { Prisma, MissionClaim } from '@prisma/client';
import { genresOf } from '../search/search';
import { initialGenres, missionDefinitions, auraRulesVersion, rankDefinitions, rankProgress } from './aura.rules';

export const claimDto = (claim: MissionClaim) => ({ missionId: claim.missionId, rewardId: claim.rewardId,
  reward: claim.rewardName, points: claim.points, rulesVersion: claim.rulesVersion, claimedAt: claim.claimedAt.toISOString() });

export async function progressData(tx: Prisma.TransactionClient, userId: string) {
  const library = await tx.libraryEntry.findMany({ where: { userId }, include: { anime: true } });
  const reviews = await tx.publication.count({ where: { userId, kind: 'review' } });
  const claims = await tx.missionClaim.findMany({ where: { userId }, orderBy: { missionId: 'asc' } });
  const catalog = await tx.anime.findMany({ select: { genres: true } });
  const genres = new Map(initialGenres.map(genre => [genre.id, genre]));
  for (const anime of catalog) for (const genre of genresOf(anime.genres)) {
    if (!genres.has(genre.id)) genres.set(genre.id, genre);
  }
  const watched = library.filter(row => row.watched);
  const genreCounts = new Map<string, number>();
  for (const row of watched) for (const id of new Set(genresOf(row.anime.genres).map(genre => genre.id))) {
    genreCounts.set(id, (genreCounts.get(id) ?? 0) + 1);
  }
  const points = claims.reduce((sum, claim) => sum + claim.points, 0);
  const missions = missionDefinitions([...genres.values()].sort((a, b) => a.id.localeCompare(b.id))).map(mission => {
    const rawProgress = mission.genreId ? genreCounts.get(mission.genreId) ?? 0 : watched.length;
    const claim = claims.find(row => row.missionId === mission.id);
    return { ...mission, rawProgress, value: Math.min(rawProgress, mission.total),
      state: claim || rawProgress >= mission.total ? 'completed' : rawProgress > 0 ? 'in_progress' : 'pending',
      claimed: !!claim, awardedPoints: claim?.points ?? null, claimedAt: claim?.claimedAt.toISOString() ?? null };
  });
  return { rulesVersion: auraRulesVersion, points,
    availablePoints: missions.filter(mission => mission.state === 'completed' && !mission.claimed).reduce((sum, mission) => sum + mission.points, 0),
    statistics: { watched: watched.length, reviews, genres: genreCounts.size,
      watchlist: library.filter(row => row.watchlist).length, favorites: library.filter(row => row.favoritePosition !== null).length },
    rank: rankProgress(points), ranks: rankDefinitions.map((rank, index) => ({ ...rank, index, unlocked: points >= rank.threshold })),
    featuredMissionIds: missions.filter(mission => !mission.claimed && mission.state !== 'completed').slice(0, 3).map(mission => mission.id),
    missions, rewards: claims.map(claimDto) };
}

/** Award inside the same transaction as the activity; never trust client-supplied points. */
export async function awardCompletedMissions(tx: Prisma.TransactionClient, userId: string) {
  const data = await progressData(tx, userId);
  for (const mission of data.missions) {
    if (mission.state !== 'completed' || mission.claimed) continue;
    await tx.missionClaim.upsert({
      where: { userId_missionId: { userId, missionId: mission.id } },
      update: {},
      create: { userId, missionId: mission.id, rewardId: mission.rewardId,
        rewardName: mission.reward, points: mission.points, rulesVersion: auraRulesVersion },
    });
  }
}

export async function synchronizedProgress(tx: Prisma.TransactionClient, userId: string) {
  await awardCompletedMissions(tx, userId);
  return progressData(tx, userId);
}
