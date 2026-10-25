import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { fixture } from './fixture';
import { rankProgress, missionStages } from '../src/modules/aura/aura.rules';

test('misiones por género y generales tienen seis etapas y cuentan animes únicos', async () => {
  const f = await fixture();
  try {
    const a = await f.account('Missions');
    const initial = (await f.request('/me/aura', a)).body;
    assert.equal(initial.points, 0); assert.equal(initial.rank.name, 'Novato');
    assert.deepEqual(initial.missions.filter((m: any) => m.groupId === 'watched').map((m: any) => m.total), [1, 5, 10, 25, 50, 100]);
    assert.ok(initial.missions.every((m: any) => m.state === 'pending'));
    for (let i = 0; i < 3; i++) assert.equal((await f.request('/reviews', a, { method: 'POST', key: randomUUID(),
      body: { animeId: 'mal:1', rating: 4, text: 'Una review completa del mismo anime.' } })).status, 201);
    const data = (await f.request('/me/aura', a)).body;
    assert.equal(data.statistics.watched, 1); assert.equal(data.statistics.reviews, 3);
    assert.equal(data.missions.find((m: any) => m.id === 'watched-1').state, 'completed');
    assert.equal(data.missions.find((m: any) => m.id === 'genre-mal-22-5').value, 1);
    assert.equal(data.points, 20); assert.equal(data.availablePoints, 0);
    assert.ok(!data.featuredMissionIds.includes('watched-1'));
    assert.ok(data.missions.find((m: any) => m.id === 'watched-1').claimed);
    assert.equal((await f.request('/me/aura')).status, 401);
  } finally { await f.close(); }
});

test('reclamos simultáneos suman puntos una sola vez y rechazan puntos del cliente', async () => {
  const f = await fixture();
  try {
    const a = await f.account('ClaimA'); const b = await f.account('ClaimB');
    assert.equal((await f.request('/me/missions/watched-1/claim', a, { method: 'PUT' })).status, 409);
    assert.equal((await f.request('/me/missions/inventada/claim', a, { method: 'PUT' })).status, 404);
    await f.request('/me/library/mal:1', a, { method: 'PATCH', body: { watched: true } });
    for (const body of [{ points: 99999 }, { userId: a.id }, { rewardId: 'otro' }]) assert.equal((await f.request('/me/missions/watched-1/claim', a, { method: 'PUT', body })).status, 400);
    const claims = await Promise.all([1, 2].map(() => f.request('/me/missions/watched-1/claim', a, { method: 'PUT' })));
    claims.forEach(result => assert.equal(result.status, 200));
    assert.deepEqual(claims[0].body.claim, claims[1].body.claim);
    assert.equal(claims[0].body.claim.points, 10);
    assert.equal(await f.db.missionClaim.count({ where: { userId: a.id } }), 2);
    await f.request('/me/missions/genre-mal-22-1/claim', a, { method: 'PUT' });
    assert.equal((await f.request('/me/aura', a)).body.points, 20);
    assert.equal((await f.request('/me/aura', b)).body.points, 0);
    await f.restart();
    assert.equal((await f.request('/me/missions/watched-1/claim', a, { method: 'PUT' })).body.aura.points, 20);
    assert.equal((await f.request('/users/' + a.id, b)).body.user.auraPoints, 20);
  } finally { await f.close(); }
});

test('progreso completo y etapas acumulables; géneros deduplicados por ID y rango por puntos', async () => {
  const f = await fixture();
  try {
    const a = await f.account('Hundred');
    for (let i = 1; i <= 100; i++) {
      await f.db.anime.create({ data: { ...await f.catalog.get('mal:' + i), genres: [
        { id: 'mal:1', name: 'Action' }, { id: 'mal:1', name: 'Acción' }, { id: 'mal:22', name: 'Romance' },
      ] } });
      await f.db.libraryEntry.create({ data: { userId: a.id, animeId: 'mal:' + i, watched: true } });
    }
    f.state.offline = true;
    const data = (await f.request('/me/aura', a)).body;
    assert.equal(data.statistics.genres, 2); assert.equal(data.statistics.watched, 100);
    assert.equal(data.missions.find((m: any) => m.id === 'genre-mal-1-100').rawProgress, 100);
    for (const stage of missionStages) assert.equal((await f.request(`/me/missions/watched-${stage.total}/claim`, a, { method: 'PUT' })).status, 200);
    const after = (await f.request('/me/aura', a)).body;
    assert.equal(after.points, 2880); assert.equal(after.rank.name, 'Maestro');
    assert.equal((await f.request('/me/missions', a)).body.claimedIds.length, 18);
  } finally { await f.close(); }
});

test('ranking usa puntos, empates y amistades recíprocas sin exponer credenciales', async () => {
  const f = await fixture();
  try {
    const a = await f.account('RankA'); const b = await f.account('RankB'); const c = await f.account('RankC');
    for (const [account, points] of [[a, 100], [b, 100], [c, 50]] as const) await f.db.missionClaim.create({ data: { userId: account.id, missionId: 'fixture', rewardId: 'fixture', rewardName: 'fixture', rulesVersion: '2', points } });
    await f.db.follow.createMany({ data: [{ followerId: a.id, followedId: b.id }, { followerId: b.id, followedId: a.id }, { followerId: a.id, followedId: c.id }] });
    const page = (await f.request('/ranking?limit=1', c)).body;
    assert.equal(page.metric, 'claimed_mission_points'); assert.equal(page.total, 3); assert.equal(page.me.position, 3);
    assert.equal(page.items[0].points, 100); assert.equal(page.items[0].position, 1);
    const next = (await f.request('/ranking?limit=1&cursor=' + page.nextCursor, c)).body;
    assert.equal(next.items[0].position, 1); assert.notEqual(next.items[0].user.id, page.items[0].user.id);
    assert.equal('passwordHash' in next.items[0].user, false);
    assert.equal((await f.request('/ranking?cursor=' + page.nextCursor, a)).status, 400);
    assert.equal((await f.request('/ranking?scope=friends&cursor=' + page.nextCursor, c)).status, 400);
    assert.equal((await f.request('/ranking?scope=friends', a)).body.total, 2);
    assert.equal((await f.request('/ranking?scope=friends', c)).body.total, 1);
  } finally { await f.close(); }
});

test('recompensas históricas se conservan sin puntos retroactivos ni duplicados', async () => {
  const f = await fixture();
  try {
    const a = await f.account('Legacy');
    await f.db.missionClaim.create({ data: { userId: a.id, missionId: 'primera', rewardId: 'primer-capitulo', rewardName: 'Primer capítulo', rulesVersion: '1' } });
    const data = (await f.request('/me/aura', a)).body;
    assert.equal(data.points, 0); assert.equal(data.rewards[0].reward, 'Primer capítulo');
    assert.equal((await f.request('/me/missions/primera/claim', a, { method: 'PUT' })).body.claim.points, 0);
    assert.equal(await f.db.missionClaim.count(), 1);
  } finally { await f.close(); }
});

test('rangos respetan umbrales de puntos y último rango', () => {
  for (const [points, rank] of [[0, 'Novato'], [99, 'Novato'], [100, 'Aprendiz'], [500, 'Experto'], [1500, 'Maestro'], [5000, 'Leyenda']] as const) assert.equal(rankProgress(points).name, rank);
  assert.equal(rankProgress(5000).nextRank, null); assert.equal(rankProgress(5000).progress, 1);
  assert.equal(rankProgress(300).progress, 0.5);
});

test('puntos automáticos son inmediatos, únicos y sobreviven quitar y volver a marcar visto', async () => {
  const f = await fixture();
  try {
    const a = await f.account('Automatic');
    const key = randomUUID();
    for (let i = 0; i < 2; i++) assert.equal((await f.request('/ratings', a, { method: 'POST', key,
      body: { animeId: 'mal:1', rating: 4 } })).status, 201);
    // No Aura read or claim request precedes the profile/ranking checks.
    assert.equal((await f.request('/users/' + a.id, a)).body.user.auraPoints, 20);
    assert.equal((await f.request('/ranking', a)).body.me.points, 20);
    assert.equal(await f.db.missionClaim.count({ where: { userId: a.id } }), 2);
    await f.request('/me/library/mal:1', a, { method: 'PATCH', body: { watched: false } });
    const removed = (await f.request('/me/aura', a)).body;
    assert.equal(removed.points, 20);
    assert.equal(removed.missions.find((m: any) => m.id === 'watched-1').state, 'completed');
    assert.ok(!removed.featuredMissionIds.includes('watched-1'));
    await f.request('/me/library/mal:1', a, { method: 'PATCH', body: { watched: true } });
    await f.restart();
    assert.equal((await f.request('/me/aura', a)).body.points, 20);
    assert.equal(await f.db.missionClaim.count({ where: { userId: a.id } }), 2);
  } finally { await f.close(); }
});
