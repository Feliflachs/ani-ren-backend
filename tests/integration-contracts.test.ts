import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { fixture } from './fixture';
import { JikanCatalog } from '../src/modules/catalog/catalog';

test('Tendencia ordena el conjunto completo y conserva páginas, filtros y cuenta tras cambios', async () => {
  const f = await fixture();
  try {
    const a = await f.account('TrendingA'); const b = await f.account('TrendingB');
    const posts = [];
    for (let i = 0; i < 4; i++) posts.push((await f.request('/posts', a, { method: 'POST', key: randomUUID(), body: { text: 'Conversación número ' + i } })).body.publication);
    await f.request(`/publications/${posts[0].id}/like`, b, { method: 'PUT' });
    await f.request(`/publications/${posts[0].id}/comments`, b, { method: 'POST', key: randomUUID(), body: { text: 'Comentario' } });
    const first = (await f.request('/feed?type=trending&limit=1', b)).body;
    assert.equal(first.items[0].id, posts[0].id); assert.equal(first.total, 4); assert.ok(first.nextCursor);
    const rest = (await f.request('/feed?type=trending&cursor=' + first.nextCursor, b)).body;
    await f.request(`/publications/${posts[3].id}/like`, b, { method: 'PUT' });
    await f.restart();
    assert.deepEqual((await f.request('/feed?type=trending&cursor=' + first.nextCursor, b)).body, rest);
    assert.equal((await f.request('/feed?type=trending&cursor=' + first.nextCursor, a)).status, 400);
    assert.equal((await f.request('/users/' + a.id + '/publications?cursor=' + first.nextCursor, b)).status, 400);
    const featured = (await f.request('/users/' + a.id + '/publications?sort=featured&limit=1', b)).body;
    assert.equal(featured.items[0].id, posts[0].id);
    assert.equal((await f.request('/users/' + b.id + '/publications?collection=likes', a)).body.total, 2);
    await f.db.querySnapshot.updateMany({ data: { expiresAt: new Date(0) } });
    assert.equal((await f.request('/feed?type=trending&cursor=' + first.nextCursor, b)).status, 410);
    assert.equal((await f.request('/feed?type=trending')).status, 401);
  } finally { await f.close(); }
});

test('biblioteca pública filtrada, cuatro favoritos y quitar visto conserva historial y puntos', async () => {
  const f = await fixture();
  try {
    const a = await f.account('LibraryA'); const b = await f.account('LibraryB');
    await f.request('/ratings', a, { method: 'POST', key: randomUUID(), body: { animeId: 'mal:1', rating: 4 } });
    await f.request('/me/missions/watched-1/claim', a, { method: 'PUT' });
    const list = (await f.request('/lists', a, { method: 'POST', key: randomUUID(), body: { title: 'Mis animes', animeIds: ['mal:1'] } })).body.list;
    assert.deepEqual((await f.request('/me/anime/mal:1/activity', a)).body.listIds, [list.id]);
    assert.equal((await f.request('/users/' + a.id + '/library?q=mal:1', b)).body.total, 1);
    assert.equal((await f.request('/users/' + a.id + '/library?q=ausente', b)).body.total, 0);
    assert.equal((await f.request('/me/favorites', a, { method: 'PUT', body: { animeIds: ['mal:1', 'mal:2', 'mal:3', 'mal:4', 'mal:5'] } })).status, 400);
    await f.request('/me/library/mal:1', a, { method: 'PATCH', body: { watched: false } });
    const aura = (await f.request('/me/aura', a)).body;
    assert.equal(aura.points, 20); assert.equal(aura.statistics.watched, 0);
    assert.equal(await f.db.ratingEntry.count(), 1);
    assert.equal((await f.request('/me/missions/watched-1/claim', a, { method: 'PUT' })).body.aura.points, 20);
    assert.equal((await f.request('/users/no-existe/library', b)).status, 404);
  } finally { await f.close(); }
});

test('distribución de estrellas usa un voto vigente por persona y conserva diez intervalos', async () => {
  const f = await fixture();
  try {
    const a = await f.account('StarsA'); const b = await f.account('StarsB');
    for (const [user, rating] of [[a, 1], [a, 5], [b, 3]] as const) await f.request('/ratings', user, { method: 'POST', key: randomUUID(), body: { animeId: 'mal:1', rating } });
    const stats = (await f.request('/anime/mal:1', a)).body.anime.statistics;
    assert.equal(stats.averageRating, 4); assert.equal(stats.watched, 2); assert.equal(stats.ratingCount, 3);
    assert.equal(stats.distribution.length, 10);
    assert.equal(stats.distributionBands.length, 5);
    assert.deepEqual(stats.distributionBands.map((row: any) => row.percentage), [50, 0, 50, 0, 0]);
    assert.equal(stats.distribution.find((row: any) => row.rating === 1).count, 0);
    assert.equal(stats.distribution.find((row: any) => row.rating === 5).percentage, 50);
  } finally { await f.close(); }
});

test('búsqueda filtrada mantiene OR de géneros y páginas vacías intermedias sin inventar totales', async () => {
  const catalog = new JikanCatalog(async url => {
    const page = new URL(String(url)).searchParams.get('page');
    return Response.json({ data: page === '1' ? [{ mal_id: 1, title: 'Otro', year: 2025, season: 'winter', genres: [{ mal_id: 4, name: 'Comedy' }] }]
      : [{ mal_id: 2, title: 'Romance', year: 2026, season: 'spring', genres: [{ mal_id: 22, name: 'Romance' }] },
        { mal_id: 3, title: 'Acción', year: 2026, season: 'spring', genres: [{ mal_id: 1, name: 'Action' }] }], pagination: { has_next_page: page === '1' } });
  });
  const filters = { genres: ['mal:22', 'mal:1'], season: 'spring', year: 2026 };
  const first = await catalog.browse('', 1, filters);
  assert.equal(first.items.length, 0); assert.equal(first.nextPage, 2);
  const last = await catalog.browse('', 2, filters);
  assert.deepEqual(last.items.map(row => row.id), ['mal:2', 'mal:3']); assert.equal(last.nextPage, null);
});

test('Biblioteca filtra listas y publicaciones antes de paginar', async () => {
  const f = await fixture();
  try {
    const user = await f.account('LibraryFilters');
    for (const title of ['Coleccion buscada', 'Otra coleccion']) {
      assert.equal((await f.request('/lists', user, { method: 'POST', key: randomUUID(), body: { title, animeIds: ['mal:1'] } })).status, 201);
    }
    const lists = await f.request(`/lists?userId=${user.id}&q=buscada&limit=1`, user);
    assert.equal(lists.status, 200); assert.equal(lists.body.total, 1);
    assert.equal(lists.body.items[0].title, 'Coleccion buscada');
    for (const text of ['Texto buscado para la biblioteca', 'Otro texto distinto']) {
      const post = await f.request('/posts', user, { method: 'POST', key: randomUUID(), body: { text } });
      await f.request(`/publications/${post.body.publication.id}/like`, user, { method: 'PUT' });
    }
    const likes = await f.request(`/users/${user.id}/publications?collection=likes&q=buscado&limit=1`, user);
    assert.equal(likes.status, 200); assert.equal(likes.body.total, 1);
    assert.equal(likes.body.items[0].text, 'Texto buscado para la biblioteca');
  } finally { await f.close(); }
});
