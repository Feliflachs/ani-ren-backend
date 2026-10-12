import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { fixture, type Account } from './fixture';

let f: Awaited<ReturnType<typeof fixture>>;
let me: Account;
let alice: Account;
let bob: Account;
let followed: Account;
let cold: Account;
let topId: string;
let mixedId: string;
const excluded = new Set<string>();
async function review(author: Account, animeId: string, text: string) {
  const rating = await f.db.ratingEntry.create({ data: { userId: author.id, animeId, rating: 4 } });
  return f.db.publication.create({ data: { userId: author.id, ratingEntryId: rating.id, text } });
}
before(async () => {
  f = await fixture();
  me = await f.account('Viewer'); alice = await f.account('Alice'); bob = await f.account('Bob');
  followed = await f.account('Followed'); cold = await f.account('NewUser');
  for (let id = 1; id <= 5; id++) await f.db.anime.create({ data: await f.catalog.get(`mal:${id}`) });
  await f.db.libraryEntry.createMany({ data: [
    { userId: me.id, animeId: 'mal:1', watched: true, favoritePosition: 0 },
    { userId: me.id, animeId: 'mal:2', watchlist: true },
    { userId: me.id, animeId: 'mal:5', watched: true },
  ] });
  await f.db.follow.create({ data: { followerId: me.id, followedId: followed.id } });
  const liked = await review(followed, 'mal:5', 'Me interesa #Mecha');
  await f.db.publicationLike.create({ data: { userId: me.id, publicationId: liked.id } });
  topId = String((await review(alice, 'mal:2', 'Una vieja recomendación de #Romance')).id);
  await review(alice, 'mal:3', 'Descubrir otro anime de #Romance');
  await review(bob, 'mal:4', 'Mi anime favorito de #Mecha');
  excluded.add(String((await review(me, 'mal:2', 'Review propia #Romance')).id));
  excluded.add(String((await review(followed, 'mal:2', 'Review de alguien seguido #Romance')).id));
  excluded.add(String((await review(alice, 'mal:1', 'Review de anime ya visto #Romance')).id));
  excluded.add(String((await f.db.publication.create({ data: { userId: bob.id, kind: 'post', text: 'Solo charla #Romance' } })).id));
  mixedId = String((await f.db.publication.create({ data: { userId: bob.id, kind: 'post', text: 'Comparo dos animes',
    mentions: { create: [{ animeId: 'mal:1', position: 0 }, { animeId: 'mal:4', position: 1 }] } } })).id);
  // Más de una página de novedades sin afinidad: el candidato antiguo debe ganar.
  for (let i = 0; i < 25; i++) await review(bob, 'mal:4', `Una recomendación reciente número ${i}`);
});
after(async () => { await f?.close(); });

test('Para ti descubre animes no vistos de desconocidos, puntúa todo el conjunto y alterna autores', async () => {
  const reads = f.state.catalogReads; f.state.offline = true;
  try {
    const first = await f.request('/feed?type=for-you&limit=2', me);
    assert.equal(first.status, 200);
    assert.equal(first.body.items[0].id, topId);
    assert.equal(first.body.items[0].recommendation.score, 5);
    assert.deepEqual(first.body.items[0].recommendation.reasons, { inWatchlist: true, matchedGenres: ['romance'], matchedTags: ['romance'] });
    assert.notEqual(first.body.items[1].userId, first.body.items[0].userId);
    assert.equal(first.body.items[1].recommendation.score, 1);
    const items = [...first.body.items];
    let cursor = first.body.nextCursor;
    while (cursor) {
      const next = await f.request(`/feed?type=for-you&limit=7&cursor=${cursor}`, me);
      assert.equal(next.status, 200); assert.equal(next.body.generatedAt, first.body.generatedAt);
      assert.equal(next.body.total, first.body.total);
      items.push(...next.body.items); cursor = next.body.nextCursor;
    }
    assert.equal(items.length, first.body.total);
    assert.equal(new Set(items.map((item) => item.id)).size, items.length);
    for (const item of items) {
      assert.ok(!excluded.has(item.id)); assert.notEqual(item.userId, me.id); assert.notEqual(item.userId, followed.id);
      assert.ok(item.recommendation.discoveryAnimeIds.length > 0);
      assert.ok(item.recommendation.discoveryAnimeIds.every((id: string) => !['mal:1', 'mal:5'].includes(id)));
    }
    const mixed = items.find((item) => item.id === mixedId);
    assert.ok(mixed); assert.deepEqual(mixed.recommendation.discoveryAnimeIds, ['mal:4']);
    assert.equal(mixed.recommendation.score, 0); // No usar el género del anime que ya vio.
    assert.equal(f.state.catalogReads, reads);
  } finally { f.state.offline = false; }
});

test('sin gustos hay descubrimiento por fecha; nunca rellena con cuentas seguidas o texto sin animes', async () => {
  const first = (await f.request('/feed?type=for-you&limit=50', cold)).body;
  assert.ok(first.total > 0);
  assert.ok(first.items.every((item: any) => item.recommendation.score === 0));
  const latest = await f.db.publication.findFirstOrThrow({ where: { ratingEntryId: { not: null } }, orderBy: { id: 'desc' } });
  assert.equal(first.items[0].id, String(latest.id));
  for (const author of [me, alice, bob, followed]) {
    await f.db.follow.create({ data: { followerId: cold.id, followedId: author.id } });
  }
  const empty = (await f.request('/feed?type=for-you', cold)).body;
  assert.equal(empty.total, 0); assert.deepEqual(empty.items, []); assert.equal(empty.nextCursor, null);
});

test('selección estable entre páginas, cuentas, likes, nuevas publicaciones y reinicios', async () => {
  const first = (await f.request('/feed?type=for-you&limit=1', me)).body;
  const cursor = first.nextCursor;
  assert.ok(cursor);
  assert.equal((await f.request(`/feed?type=for-you&cursor=${cursor}`, alice)).status, 400);
  assert.equal((await f.request(`/feed?type=following&cursor=${cursor}`, me)).status, 400);
  const before = (await f.request(`/feed?type=for-you&limit=2&cursor=${cursor}`, me)).body;
  const newest = await review(bob, 'mal:2', 'Otro anime en tu watchlist #Romance');
  assert.equal((await f.request(`/publications/${newest.id}/like`, me, { method: 'PUT' })).status, 200);
  await f.restart();
  const afterRestart = (await f.request(`/feed?type=for-you&limit=2&cursor=${cursor}`, me)).body;
  assert.deepEqual(afterRestart.items.map((item: any) => item.id), before.items.map((item: any) => item.id));
  assert.equal(afterRestart.total, first.total);
  assert.equal(afterRestart.generatedAt, first.generatedAt);
  assert.ok(afterRestart.items.every((item: any) => item.id !== String(newest.id)));
  const renewed = (await f.request('/feed?type=for-you&limit=1', me)).body;
  assert.equal(renewed.items[0].id, String(newest.id));
  assert.equal((await f.request(`/feed?type=for-you&cursor=${cursor}`, me)).status, 410);
  assert.equal(await f.db.feedSnapshot.count({ where: { userId: me.id } }), 1);
  await f.db.feedSnapshot.updateMany({ where: { userId: me.id }, data: { expiresAt: new Date(0) } });
  const expired = await f.request(`/feed?type=for-you&cursor=${renewed.nextCursor}`, me);
  assert.equal(expired.status, 410); assert.equal(expired.body.error.code, 'FEED_EXPIRED');
  assert.equal((await f.request('/feed?type=for-you&cursor=basura', me)).status, 400);
  assert.equal((await f.request('/feed?type=for-you')).status, 401);
});

test('seguir a un autor y marcar vistos se respeta de inmediato aunque el cursor sea anterior', async () => {
  const first = (await f.request('/feed?type=for-you&limit=1', me)).body;
  assert.ok(first.nextCursor);
  assert.equal((await f.request(`/me/following/${bob.id}`, me, { method: 'PUT' })).status, 200);
  const next = (await f.request(`/feed?type=for-you&limit=50&cursor=${first.nextCursor}`, me)).body;
  assert.ok(next.items.every((item: any) => item.userId !== bob.id));
  assert.ok(next.total < first.total);
  await f.request('/me/library/mal:2', me, { method: 'PATCH', body: { watched: true } });
  await f.request('/me/library/mal:3', me, { method: 'PATCH', body: { watched: true } });
  const empty = (await f.request(`/feed?type=for-you&cursor=${first.nextCursor}`, me)).body;
  assert.equal(empty.total, 0); assert.deepEqual(empty.items, []);
  assert.equal((await f.request('/feed?type=following', me)).body.total > 0, true);
});

test('géneros y hashtags con guiones usan la misma normalización que el frontend', async () => {
  const viewer = await f.account('SciFiFan');
  await f.db.libraryEntry.create({ data: { userId: viewer.id, animeId: 'mal:4', favoritePosition: 0 } });
  const candidate = await review(alice, 'mal:4', 'Para fans de #Sci-Fi');
  const page = (await f.request('/feed?type=for-you&limit=1', viewer)).body;
  assert.equal(page.items[0].id, String(candidate.id));
  assert.equal(page.items[0].recommendation.score, 2);
  assert.deepEqual(page.items[0].recommendation.reasons.matchedGenres, ['scifi']);
  assert.deepEqual(page.items[0].recommendation.reasons.matchedTags, ['scifi']);
});
