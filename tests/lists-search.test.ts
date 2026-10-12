import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { fixture, type Account } from './fixture';

let f: Awaited<ReturnType<typeof fixture>>;
let alice: Account;
let bob: Account;
let listId: string;
before(async () => { f = await fixture(); alice = await f.account('Alice'); bob = await f.account('Bob'); });
after(async () => { await f?.close(); });

test('listas preservan orden incluso sin ranking; reintentos no duplican y no crean actividad', async () => {
  const body = { title: 'Animación para disfrutar', description: 'Historias de verano', animeIds: ['mal:4', 'mal:2', 'mal:1'], ordered: false };
  const options = { method: 'POST', key: 'create-list-00001', body };
  const created = await f.request('/lists', alice, options);
  assert.equal(created.status, 201); listId = created.body.list.id;
  assert.deepEqual(created.body.list.animeIds, body.animeIds);
  assert.deepEqual(created.body.list.items.map((item: any) => item.position), [0, 1, 2]);
  assert.equal(created.body.list.updatedAt, null);
  assert.deepEqual((await f.request('/lists', alice, options)).body, created.body);
  assert.equal((await f.request('/lists', alice, { ...options, body: { ...body, title: 'Otro título' } })).status, 409);
  assert.equal(await f.db.animeList.count(), 1);
  assert.equal(await f.db.libraryEntry.count(), 0); assert.equal(await f.db.ratingEntry.count(), 0);
  assert.equal((await f.request(`/lists/${listId}`, bob)).body.list.author.id, alice.id);
  for (const invalid of [{ ...body, animeIds: [] }, { ...body, animeIds: ['mal:1', 'mal:1'] },
    { ...body, userId: bob.id }, { ...body, title: 'ab' }]) {
    assert.equal((await f.request('/lists', alice, { ...options, body: invalid })).status, 400);
  }
  assert.equal((await f.request('/lists', undefined, options)).status, 401);
  const responses = await Promise.all([f.request('/lists', alice, { ...options, key: 'concurrent-list-01' }),
    f.request('/lists', alice, { ...options, key: 'concurrent-list-01' })]);
  for (const response of responses) assert.equal(response.status, 201);
  assert.equal(responses[0].body.list.id, responses[1].body.list.id);
});

test('edición y likes de listas: permisos, reemplazo atómico y conservación de interacciones', async () => {
  assert.equal((await f.request(`/lists/${listId}`, bob, { method: 'PATCH', body: { title: 'Ajena' } })).status, 403);
  const responses = await Promise.all([f.request(`/lists/${listId}/like`, bob, { method: 'PUT' }),
    f.request(`/lists/${listId}/like`, bob, { method: 'PUT' })]);
  for (const response of responses) { assert.equal(response.status, 200); assert.equal(response.body.likeCount, 1); }
  const original = (await f.request(`/lists/${listId}`, alice)).body.list;
  const edited = await f.request(`/lists/${listId}`, alice, { method: 'PATCH', body: { animeIds: ['mal:1', 'mal:4'], ordered: true } });
  assert.equal(edited.status, 200); assert.equal(edited.body.list.likeCount, 1); assert.equal(edited.body.list.likedByMe, false);
  assert.equal(edited.body.list.createdAt, original.createdAt); assert.ok(edited.body.list.updatedAt);
  assert.deepEqual(edited.body.list.animeIds, ['mal:1', 'mal:4']);
  assert.equal((await f.request(`/lists/${listId}`, bob)).body.list.likedByMe, true);
  await f.db.$executeRawUnsafe(`CREATE TRIGGER reject_list_item BEFORE INSERT ON ListItem
    WHEN NEW.position = 1 BEGIN SELECT RAISE(ABORT, 'test failure'); END;`);
  try {
    assert.equal((await f.request(`/lists/${listId}`, alice, { method: 'PATCH', body: { title: 'Fallo', animeIds: ['mal:4', 'mal:1'] } })).status, 500);
    assert.deepEqual((await f.request(`/lists/${listId}`, alice)).body.list, edited.body.list);
  } finally { await f.db.$executeRawUnsafe('DROP TRIGGER reject_list_item'); }
  f.state.offline = true;
  try {
    assert.equal((await f.request(`/lists/${listId}`, alice, { method: 'PATCH', body: { animeIds: ['mal:999'] } })).status, 503);
    assert.deepEqual((await f.request(`/lists/${listId}`, alice)).body.list.animeIds, ['mal:1', 'mal:4']);
  } finally { f.state.offline = false; }
  for (let i = 0; i < 2; i++) assert.equal((await f.request(`/lists/${listId}/like`, bob, { method: 'DELETE' })).body.likeCount, 0);
  assert.equal((await f.request('/lists/99999/like', bob, { method: 'PUT' })).status, 404);
  assert.equal((await f.request('/lists/99999', bob)).status, 404);
  const page = (await f.request(`/lists?userId=${alice.id}&limit=1`, bob)).body;
  assert.equal(page.total, 2); assert.ok(page.nextCursor);
  assert.notEqual((await f.request(`/lists?userId=${alice.id}&limit=1&cursor=${page.nextCursor}`, bob)).body.items[0].id, page.items[0].id);
  assert.equal((await f.request(`/lists?userId=${bob.id}&cursor=${page.nextCursor}`, bob)).status, 400);
});

test('búsqueda normaliza tildes, separa categorías, hashtags exactos y filtros de anime', async () => {
  await f.db.user.update({ where: { id: alice.id }, data: { name: 'Alicia Animación', bio: '100% historias' } });
  const first = await f.request('/posts', alice, { method: 'POST', key: 'search-post-0001',
    body: { text: 'Me gusta la #Animación y el romance', animeIds: ['mal:1', 'mal:4'] } });
  assert.equal(first.status, 201);
  await f.request('/posts', bob, { method: 'POST', key: 'search-post-0002', body: { text: 'Otras #Animaciones', animeIds: ['mal:2'] } });
  const users = await f.request('/search?type=users&q=ANIMACION', bob);
  assert.equal(users.body.total, 1); assert.equal(users.body.items[0].id, alice.id);
  assert.equal('passwordHash' in users.body.items[0], false);
  assert.equal((await f.request('/search?type=users&q=%25', bob)).body.total, 1);
  assert.equal((await f.request('/search?type=lists&q=animacion', bob)).body.total, 2);
  assert.equal((await f.request('/search?type=publications&q=animacion', bob)).body.total, 2);
  const tags = (await f.request('/search?type=publications&q=%23ANIMACI%C3%93N', bob)).body;
  assert.equal(tags.total, 1); assert.equal(tags.items[0].id, first.body.publication.id);
  assert.equal((await f.request('/search?type=publications&q=Anime%20mal:4', bob)).body.total, 1);
  assert.equal((await f.request('/search?type=publications&genres=mal:24&season=winter&year=2025', bob)).body.total, 1);
  assert.equal((await f.request('/search?type=publications&genres=mal:24&season=spring', bob)).body.total, 0);
  assert.equal((await f.request('/search?type=lists&genres=mal:22,mal:24', bob)).body.total, 2);
  assert.equal((await f.request('/search?type=users&genres=mal:22', bob)).status, 400);
  await f.request('/posts', bob, { method: 'POST', key: 'search-post-0003', body: { text: 'Me encanta #Sci-Fi' } });
  assert.equal((await f.request('/search?type=publications&q=%23sci-fi', bob)).body.total, 1);
  assert.equal((await f.request('/search?type=publications&q=%23sci-fi%20otras', bob)).body.total, 0);
  assert.equal((await f.request('/search?type=publications&genres=invalid', bob)).status, 400);
  const page = (await f.request('/search?type=publications&q=animacion&limit=1', bob)).body;
  assert.equal(page.total, 2);
  const next = (await f.request(`/search?type=publications&q=animacion&limit=1&cursor=${page.nextCursor}`, bob)).body;
  assert.notEqual(next.items[0].id, page.items[0].id); assert.equal(next.nextCursor, null);
  assert.equal((await f.request(`/search?type=publications&q=otro&cursor=${page.nextCursor}`, bob)).status, 400);
  assert.equal((await f.request(`/search?type=lists&q=animacion&cursor=${page.nextCursor}`, bob)).status, 400);
  assert.equal((await f.request('/search?type=anime&q=Naruto', bob)).body.nextPage, 2);
  f.state.offline = true;
  try {
    assert.equal((await f.request('/search?type=users&q=alice', bob)).status, 200);
    assert.equal((await f.request('/search?type=anime&q=Naruto', bob)).status, 503);
  } finally { f.state.offline = false; }
  await f.restart();
  assert.deepEqual((await f.request(`/lists/${listId}`, alice)).body.list.animeIds, ['mal:1', 'mal:4']);
});
