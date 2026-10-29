import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { fixture } from './fixture';
import { discoveryScore, freshness } from '../src/modules/discovery/ranking';

test('Descubrir: señales vencen, personas repetidas no inflan y buenas valoraciones pesan más', () => {
  const now = new Date('2026-10-26T12:00:00Z');
  const old = new Date('2026-09-01T12:00:00Z');
  const recent = { userId: 'a', rating: 5, createdAt: now };
  const event = { userId: 'b', createdAt: now };
  assert.equal(freshness(new Date('2026-10-23T12:00:00Z'), now), 0.5);
  assert.equal(discoveryScore([], Array.from({ length: 1000 }, (_, i) => ({ userId: String(i), createdAt: old })), now), 0);
  assert.equal(discoveryScore([recent], [event], now), discoveryScore([recent], Array(100).fill(event), now));
  assert.ok(discoveryScore([recent], [], now) > discoveryScore([{ ...recent, rating: 1 }], [], now));
  assert.ok(discoveryScore([recent], [], now) > discoveryScore([{ ...recent, createdAt: new Date('2026-10-20T12:00:00Z') }], [], now));
});

test('Descubrir no usa afinidad, pierde likes viejos y prioriza conversaciones recientes', async () => {
  const f = await fixture();
  try {
    const viewer = await f.account('RankingViewer');
    const a = await f.account('RankingAuthor');
    const b = await f.account('RankingOther');
    // Viewer prefers Romance; mal:4 is Sci-Fi.
    await f.request('/me/library/mal:1', viewer, { method: 'PATCH', body: { watchlist: true } });
    const create = async (animeId: string, author = a) => {
      const result = await f.request('/reviews', author, { method: 'POST', key: randomUUID(),
        body: { animeId, rating: 5, text: 'Una opinión para descubrir algo nuevo.' } });
      assert.equal(result.status, 201);
      return result.body.publication;
    };
    const ancient = await create('mal:1');
    await f.request(`/publications/${ancient.id}/like`, viewer, { method: 'PUT' });
    const old = new Date(Date.now() - 40 * 86_400_000);
    await f.db.publication.update({ where: { id: Number(ancient.id) }, data: { createdAt: old } });
    await f.db.ratingEntry.updateMany({ where: { animeId: 'mal:1' }, data: { createdAt: old } });
    await f.db.publicationLike.updateMany({ data: { createdAt: old } });
    const fresh = await create('mal:4', b);
    const first = await f.request('/discover', viewer);
    assert.equal(first.status, 200);
    assert.equal(first.body.items[0].id, 'mal:4');
    assert.equal(first.body.items[0].reviews[0].id, fresh.id);
    assert.equal(first.body.items[0].reviews[0].likedByMe, false);
    // A different reader's like must not mark the review as liked by the viewer.
    await f.request(`/publications/${fresh.id}/like`, a, { method: 'PUT' });
    assert.equal((await f.request('/discover', viewer)).body.items[0].reviews[0].likedByMe, false);
  } finally { await f.close(); }
});

test('respuestas paginadas, aislamiento de hilos y borrado autorizado conservando valoración', async () => {
  const f = await fixture();
  try {
    const a = await f.account('ThreadAuthor'); const b = await f.account('ThreadReader');
    const review = (await f.request('/reviews', a, { method: 'POST', key: randomUUID(),
      body: { animeId: 'mal:1', rating: 4, text: 'Una review con una conversación.' } })).body.publication;
    const post = (await f.request('/posts', a, { method: 'POST', key: randomUUID(), body: { text: 'Otro posteo de prueba' } })).body.publication;
    const comment = async (publicationId: string, text: string, parentId?: string, key = randomUUID()) => f.request(`/publications/${publicationId}/comments`, b,
      { method: 'POST', key, body: { text, ...(parentId ? { parentId } : {}) } });
    const root = (await comment(review.id, 'Comentario principal')).body.comment;
    const key = randomUUID();
    const reply = await comment(review.id, 'Primera respuesta', root.id, key);
    assert.equal(reply.status, 201);
    assert.equal((await comment(review.id, 'Primera respuesta', root.id, key)).body.comment.id, reply.body.comment.id);
    assert.equal((await comment(post.id, 'Hilo de otro post', root.id)).status, 400);
    assert.equal((await comment(review.id, 'Un tercer nivel', reply.body.comment.id)).status, 400);
    for (let i = 0; i < 21; i++) await comment(review.id, `Respuesta ${i}`, root.id);
    const roots = (await f.request(`/publications/${review.id}/comments`, a)).body;
    assert.equal(roots.total, 1); assert.equal(roots.items[0].replyCount, 22);
    const first = (await f.request(`/publications/${review.id}/comments?parentId=${root.id}`, a)).body;
    assert.equal(first.items.length, 20); assert.ok(first.nextCursor);
    const next = (await f.request(`/publications/${review.id}/comments?parentId=${root.id}&cursor=${first.nextCursor}`, a)).body;
    assert.equal(next.items.length, 2);
    assert.equal((await f.request(`/publications/${review.id}/comments?cursor=${first.nextCursor}`, a)).status, 400);
    await f.request(`/publications/${review.id}/like`, b, { method: 'PUT' });
    assert.equal((await f.request(`/publications/${review.id}`, b, { method: 'DELETE' })).status, 403);
    assert.equal((await f.request(`/publications/${review.id}`, a, { method: 'DELETE' })).status, 200);
    assert.equal(await f.db.comment.count(), 0);
    assert.equal(await f.db.publicationLike.count(), 0);
    assert.equal((await f.request(`/publications/${review.id}`, a)).status, 404);
    const activity = (await f.request('/me/anime/mal:1/activity', a)).body;
    assert.equal(activity.watched, true); assert.equal(activity.currentRating.rating, 4);
    assert.equal(activity.currentRating.publicationId, null);
    assert.equal((await f.request(`/publications/${post.id}`, a, { method: 'DELETE' })).status, 200);
  } finally { await f.close(); }
});
