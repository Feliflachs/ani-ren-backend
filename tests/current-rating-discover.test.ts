import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { fixture } from './fixture';

test('un voto por persona: cambiar estrellas antiguas actualiza el vigente, texto y reintentos no', async () => {
  const f = await fixture();
  try {
    const a = await f.account('OpinionA'); const b = await f.account('OpinionB');
    const create = async (rating: number) => {
      const result = await f.request('/reviews', a, { method: 'POST', key: randomUUID(), body: { animeId: 'mal:1', rating, text: 'Una opinión completa del anime.' } });
      assert.equal(result.status, 201); return result.body.publication;
    };
    const old = await create(3); const recent = await create(5);
    await f.request('/ratings', b, { method: 'POST', key: randomUUID(), body: { animeId: 'mal:1', rating: 2 } });
    const stats = async () => (await f.request('/anime/mal:1', a)).body.anime.statistics;
    const current = async () => (await f.request('/me/anime/mal:1/activity', a)).body.currentRating;
    assert.equal((await stats()).averageRating, 3.5);
    assert.equal((await stats()).ratingUserCount, 2);
    assert.equal((await stats()).ratingCount, 3);
    await f.request('/reviews/' + old.id, a, { method: 'PATCH', body: { text: 'Solo corrijo el texto de antes.', rating: 3 } });
    assert.equal((await current()).rating, 5);
    const edited = await f.request('/reviews/' + old.id, a, { method: 'PATCH', body: { rating: 4 } });
    assert.equal(edited.status, 200); assert.equal(edited.body.publication.createdAt, old.createdAt);
    assert.equal((await current()).rating, 4); assert.equal((await stats()).averageRating, 3);
    // Guardar el mismo número en otra entrada no equivale a cambiar estrellas.
    await f.request('/reviews/' + recent.id, a, { method: 'PATCH', body: { rating: 5, spoiler: true } });
    assert.equal((await current()).rating, 4);
    const key = randomUUID(); const body = { animeId: 'mal:1', rating: 1 };
    await f.request('/ratings', a, { method: 'POST', key, body });
    await create(4.5);
    await f.request('/ratings', a, { method: 'POST', key, body });
    assert.equal((await current()).rating, 4.5);
    await f.restart();
    assert.equal((await current()).rating, 4.5);
  } finally { await f.close(); }
});

test('Descubrir agrupa animes no vistos con dos autores distintos, spoilers y votos vigentes', async () => {
  const f = await fixture();
  try {
    const viewer = await f.account('DiscoverViewer'); const a = await f.account('DiscoverA'); const b = await f.account('DiscoverB');
    for (let i = 1; i <= 4; i++) await f.db.anime.create({ data: await f.catalog.get('mal:' + i) });
    await f.request('/me/library/mal:1', viewer, { method: 'PATCH', body: { watched: true } });
    await f.request('/me/library/mal:2', viewer, { method: 'PATCH', body: { watchlist: true } });
    await f.request('/me/following/' + a.id, viewer, { method: 'PUT' });
    for (const [author, rating] of [[a, 5], [a, 4], [b, 1]] as const) {
      assert.equal((await f.request('/reviews', author, { method: 'POST', key: randomUUID(), body: {
        animeId: 'mal:2', rating, text: 'Esta opinión contiene un spoiler.', spoiler: true,
      } })).status, 201);
    }
    f.state.offline = true;
    const first = (await f.request('/discover?limit=1', viewer)).body;
    assert.equal(first.total, 3); assert.ok(first.nextCursor);
    assert.equal((await f.request('/discover?cursor=' + first.nextCursor, a)).status, 400);
    assert.equal((await f.request('/feed?type=for-you&cursor=' + first.nextCursor, viewer)).status, 400);
    const next = (await f.request('/discover?cursor=' + first.nextCursor, viewer)).body;
    const all = [...first.items, ...next.items];
    assert.equal(new Set(all.map((item) => item.id)).size, 3);
    assert.ok(all.every((item) => item.id !== 'mal:1'));
    const card = all.find((item) => item.id === 'mal:2');
    assert.equal(card.watchlist, true); assert.equal(card.anime.statistics.averageRating, 2.5);
    assert.equal(card.reviews.length, 2); assert.equal(new Set(card.reviews.map((r: any) => r.userId)).size, 2);
    assert.ok(card.reviews.every((r: any) => r.spoiler));
    assert.ok(all.some((item) => item.reviews.length === 0));
    await f.request('/me/library/mal:2', viewer, { method: 'PATCH', body: { watched: true } });
    const updated = (await f.request('/discover?cursor=' + first.nextCursor, viewer)).body;
    assert.equal(updated.total, 2); assert.ok(updated.items.every((item: any) => item.id !== 'mal:2'));
    await f.restart();
    assert.equal((await f.request('/discover?cursor=' + first.nextCursor, viewer)).status, 200);
    await f.request('/discover', viewer);
    assert.equal((await f.request('/discover?cursor=' + first.nextCursor, viewer)).status, 410);
    assert.equal((await f.request('/discover')).status, 401);
  } finally { await f.close(); }
});
