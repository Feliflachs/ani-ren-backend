import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { fixture, type Account } from './fixture';
import { rankProgress } from '../src/aura';

let f: Awaited<ReturnType<typeof fixture>>;
let alice: Account;
let bob: Account;
let carol: Account;
before(async () => { f = await fixture(); alice = await f.account('Alice'); bob = await f.account('Bob'); carol = await f.account('Carol'); });
after(async () => { await f?.close(); });
const mission = (data: any, id: string) => data.missions.find((item: any) => item.id === id);

test('misiones usan animes distintos; reviews repetidas suman, estrellas y ediciones no', async () => {
  const initial = (await f.request('/me/aura', alice)).body;
  assert.equal(initial.rank.name, 'Novato'); assert.equal(initial.rank.nextThreshold, 100);
  assert.equal(initial.ranks.length, 5); assert.equal(initial.ranks[0].unlocked, true); assert.equal(initial.ranks[1].unlocked, false);
  assert.ok(initial.missions.every((item: any) => item.state === 'pending'));
  assert.equal((await f.request('/me/aura')).status, 401);
  let reviewId: string = '';
  for (let index = 0; index < 3; index++) {
    const created = await f.request('/reviews', alice, { method: 'POST', key: `aura-review-0000${index}`,
      body: { animeId: 'mal:1', rating: 4, text: `Una opinión nueva número ${index}` } });
    assert.equal(created.status, 201); reviewId = created.body.publication.id;
  }
  await f.request(`/reviews/${reviewId}`, alice, { method: 'PATCH', body: { rating: 5, text: 'Edición de una review existente' } });
  await f.request('/ratings', alice, { method: 'POST', key: 'aura-rating-00001', body: { animeId: 'mal:1', rating: 3.5, rewatched: true } });
  await f.request('/posts', alice, { method: 'POST', key: 'aura-post-0000001', body: { text: 'Un post no es una review', animeIds: ['mal:1'] } });
  const data = (await f.request('/me/aura', alice)).body;
  assert.equal(data.statistics.watched, 1); assert.equal(data.statistics.reviews, 3);
  assert.equal((await f.request(`/users/${alice.id}`, bob)).body.user.rank.watched, 1);
  assert.equal(mission(data, 'romance').value, 1); assert.equal(mission(data, 'romance').state, 'in_progress');
  assert.equal(mission(data, 'reviews').state, 'completed'); assert.equal(mission(data, 'reviews').rawProgress, 3);
  assert.equal(mission(data, 'primera').state, 'completed'); assert.equal(data.rewards.length, 0);
  assert.equal((await f.request('/me/aura', bob)).body.statistics.watched, 0);
});

test('recompensas requieren elegibilidad real y son únicas incluso ante reclamos simultáneos', async () => {
  assert.equal((await f.request('/me/missions/romance/claim', alice, { method: 'PUT' })).status, 409);
  assert.equal((await f.request('/me/missions/reviews/claim', bob, { method: 'PUT' })).status, 409);
  assert.equal((await f.request('/me/missions/no-existe/claim', alice, { method: 'PUT' })).status, 404);
  for (const body of [{ userId: alice.id }, { value: 3 }, { rewardId: 'otra' }]) {
    assert.equal((await f.request('/me/missions/reviews/claim', bob, { method: 'PUT', body })).status, 400);
  }
  const requests = await Promise.all([
    f.request('/me/missions/reviews/claim', alice, { method: 'PUT' }),
    f.request('/me/missions/reviews/claim', alice, { method: 'PUT' }),
  ]);
  for (const result of requests) assert.equal(result.status, 200);
  assert.deepEqual(requests[0].body, requests[1].body);
  assert.equal(requests[0].body.claim.reward, 'Voz de la comunidad');
  assert.equal(await f.db.missionClaim.count({ where: { userId: alice.id } }), 1);
  assert.deepEqual((await f.request('/me/missions/reviews/claim', alice, { method: 'PUT' })).body, requests[0].body);
  assert.equal((await f.request('/me/missions', alice)).body.claimedIds.includes('reviews'), true);
  const other = await f.request('/me/missions/primera/claim', alice, { method: 'PUT' });
  assert.equal(other.status, 200);
  const afterClaim = (await f.request('/me/aura', alice)).body;
  assert.equal(afterClaim.statistics.watched, 1); assert.equal(afterClaim.rank.name, 'Novato');
  assert.equal(afterClaim.rewards.length, 2);
});

test('géneros se deduplican por ID y Acción admite el nombre del proveedor sin confundir Shounen', async () => {
  for (let id = 2; id <= 4; id++) {
    const metadata = await f.catalog.get(`mal:${id}`);
    await f.db.anime.upsert({ where: { id: metadata.id }, create: metadata, update: metadata });
  }
  await f.db.anime.update({ where: { id: 'mal:2' }, data: { genres: [
    { id: 'mal:1', name: 'Action' }, { id: 'mal:1', name: 'Acción' }, { id: 'mal:22', name: 'Romance' },
    { id: 'mal:10', name: 'Fantasy' }, { id: 'mal:30', name: 'Sports' },
  ] } });
  await f.db.anime.update({ where: { id: 'mal:3' }, data: { genres: [{ id: 'mal:1', name: 'Acción' }] } });
  await f.db.anime.update({ where: { id: 'mal:4' }, data: { genres: [{ id: 'mal:27', name: 'Shounen' }] } });
  for (const animeId of ['mal:2', 'mal:3', 'mal:4']) await f.request(`/me/library/${animeId}`, alice, { method: 'PATCH', body: { watched: true } });
  const data = (await f.request('/me/aura', alice)).body;
  assert.equal(data.statistics.watched, 4); assert.equal(data.statistics.genres, 5);
  assert.equal(mission(data, 'romance').value, 2); assert.equal(mission(data, 'generos').value, 4);
  assert.equal(mission(data, 'generos').rawProgress, 5); assert.equal(mission(data, 'shonen').value, 2);
  assert.equal((await f.request('/me/missions/shonen/claim', alice, { method: 'PUT' })).status, 409);
  const claimed = await f.request('/me/missions/romance/claim', alice, { method: 'PUT' });
  assert.equal(claimed.status, 200);
  // Una corrección futura de metadatos no revoca una recompensa ya otorgada.
  await f.db.anime.update({ where: { id: 'mal:2' }, data: { genres: [] } });
  assert.deepEqual((await f.request('/me/missions/romance/claim', alice, { method: 'PUT' })).body, claimed.body);
  assert.equal(mission((await f.request('/me/aura', alice)).body, 'romance').claimed, true);
});

test('Aura consulta toda la biblioteca, conserva reclamos tras reiniciar y no depende de Jikan', async () => {
  for (let index = 100; index < 121; index++) {
    await f.db.anime.create({ data: await f.catalog.get(`mal:${index}`) });
    await f.db.libraryEntry.create({ data: { userId: bob.id, animeId: `mal:${index}`, watched: true } });
  }
  assert.equal((await f.request('/me/library?limit=1', bob)).body.items.length, 1);
  assert.equal((await f.request('/me/aura', bob)).body.statistics.watched, 21);
  const before = (await f.request('/me/aura', alice)).body;
  await f.restart(); f.state.offline = true;
  try {
    assert.deepEqual((await f.request('/me/aura', alice)).body, before);
    assert.equal((await f.request('/me/missions/romance/claim', bob, { method: 'PUT' })).status, 200);
    assert.equal((await f.request('/me/missions', bob)).body.claimedIds.includes('romance'), true);
  } finally { f.state.offline = false; }
});

test('ranking global y de amigos: totales, empates, posición propia fuera de página y privacidad', async () => {
  // Carol empata con Alice en 4 vistos; Bob lleva 21.
  for (const animeId of ['mal:1', 'mal:2', 'mal:3', 'mal:4']) {
    await f.db.libraryEntry.create({ data: { userId: carol.id, animeId, watched: true } });
  }
  await f.db.follow.createMany({ data: [
    { followerId: alice.id, followedId: bob.id }, { followerId: bob.id, followedId: alice.id },
    { followerId: alice.id, followedId: carol.id },
  ] });
  const first = (await f.request('/ranking?limit=1', alice)).body;
  assert.equal(first.total, 3); assert.equal(first.items[0].user.id, bob.id);
  assert.equal(first.me.position, 2); assert.equal(first.me.watched, 4);
  const second = (await f.request(`/ranking?limit=1&cursor=${first.nextCursor}`, alice)).body;
  const third = (await f.request(`/ranking?limit=1&cursor=${second.nextCursor}`, alice)).body;
  assert.equal(second.items[0].position, 2); assert.equal(third.items[0].position, 2);
  assert.notEqual(second.items[0].user.id, third.items[0].user.id); assert.equal(third.nextCursor, null);
  assert.equal('passwordHash' in first.items[0].user, false);
  const friends = (await f.request('/ranking?scope=friends', alice)).body;
  assert.equal(friends.total, 2); assert.ok(friends.items.every((item: any) => [alice.id, bob.id].includes(item.user.id)));
  assert.equal((await f.request('/ranking?scope=friends', carol)).body.total, 1);
  assert.equal((await f.request(`/ranking?scope=friends&cursor=${first.nextCursor}`, alice)).status, 400);
  assert.equal((await f.request(`/ranking?cursor=${first.nextCursor}`, bob)).status, 400);
  assert.equal((await f.request('/ranking?cursor=basura', alice)).status, 400);
  assert.equal((await f.request('/ranking?scope=country', alice)).status, 400);
});

test('rangos respetan umbrales y el último rango no inventa otro objetivo', () => {
  assert.equal(rankProgress(99).name, 'Novato'); assert.equal(rankProgress(99).remaining, 1);
  assert.equal(rankProgress(100).name, 'Aprendiz'); assert.equal(rankProgress(100).progress, 0);
  assert.equal(rankProgress(199).nextThreshold, 200);
  assert.equal(rankProgress(200).name, 'Experto'); assert.equal(rankProgress(300).name, 'Maestro');
  const legend = rankProgress(450);
  assert.equal(legend.name, 'Leyenda'); assert.equal(legend.nextRank, null);
  assert.equal(legend.nextThreshold, null); assert.equal(legend.remaining, 0); assert.equal(legend.progress, 1);
});
