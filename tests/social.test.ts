import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import type { Server } from 'node:http';
import { PrismaClient } from '@prisma/client';
import { createApp } from '../src/app';
import type { Catalog } from '../src/modules/catalog/catalog';
import { ApiError } from '../src/shared/errors';

const root = path.resolve('.test-data');
let directory: string;
let databaseUrl: string;
let db: PrismaClient;
let server: Server;
let base: string;
type Account = { token: string; user: { id: string } };
let alice: Account;
let bob: Account;
let carol: Account;
let offline = false;
let postId: string;
let reviewId: string;
const catalog: Catalog = {
  async get(id) {
    if (offline) throw new ApiError(503, 'CATALOG_UNAVAILABLE', 'Proveedor de prueba sin conexión.');
    return { id, externalId: Number(id.slice(4)), title: `Prueba ${id}`, japanese: null,
      imageUrl: null, synopsis: null, episodes: null, year: null, season: null, genres: [] };
  },
  async search() { return { items: [], nextPage: null }; },
};

async function start() {
  db = new PrismaClient({ datasourceUrl: databaseUrl });
  const app = createApp({ db, catalog, corsOrigins: ['http://localhost:8081'], sessionDays: 7, timeZone: 'America/Buenos_Aires' });
  server = await new Promise<Server>((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  base = `http://127.0.0.1:${address.port}/api`;
}
async function stop() {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  });
  await db.$disconnect();
}
async function call(route: string, account?: Account, method = 'GET', body?: unknown, key?: string) {
  const response = await fetch(base + route, { method, headers: {
    ...(account ? { Authorization: `Bearer ${account.token}` } : {}),
    ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    ...(key ? { 'Idempotency-Key': key } : {}),
  }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: response.status === 204 ? null : await response.json() };
}
async function register(handle: string): Promise<Account> {
  const data = { handle, password: 'Social2026' };
  assert.equal((await call('/auth/register', undefined, 'POST', data)).status, 201);
  const result = await call('/auth/login', undefined, 'POST', data);
  assert.equal(result.status, 200);
  return result.body;
}
before(async () => {
  await mkdir(root, { recursive: true });
  directory = await mkdtemp(path.join(root, 'social-'));
  databaseUrl = `file:${path.join(directory, 'test.db').replaceAll('\\', '/')}`;
  execFileSync(process.execPath, [path.resolve('scripts/prisma.cjs'), 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: 'pipe', windowsHide: true,
  });
  await start();
  alice = await register('SocialAlice'); bob = await register('SocialBob'); carol = await register('SocialCarol');
});
after(async () => {
  if (server) await stop();
  if (directory) {
    const target = path.resolve(directory);
    if (!target.startsWith(root + path.sep)) throw new Error('Directorio de pruebas inválido');
    await rm(target, { recursive: true, force: true });
  }
});

test('posteos con referencias y hashtags no crean votos, reviews ni vistos; reintentos son seguros', async () => {
  const input = { text: 'Hablemos de #Naruto y #Animación', animeIds: ['mal:20', 'mal:21'] };
  const first = await call('/posts', alice, 'POST', input, 'social-post-00001');
  assert.equal(first.status, 201);
  postId = first.body.publication.id;
  assert.equal(first.body.publication.kind, 'post');
  assert.equal(first.body.publication.rating, null);
  assert.equal(first.body.publication.ratingEntryId, null);
  assert.deepEqual(first.body.publication.animeIds, ['mal:20', 'mal:21']);
  assert.deepEqual(first.body.publication.tags, ['naruto', 'animacion']);
  assert.deepEqual((await call('/posts', alice, 'POST', input, 'social-post-00001')).body, first.body);
  assert.equal((await call('/posts', alice, 'POST', { ...input, text: 'Otro texto' }, 'social-post-00001')).status, 409);
  assert.equal(await db.ratingEntry.count(), 0);
  assert.equal(await db.libraryEntry.count(), 0);
  assert.equal((await call(`/users/${alice.user.id}`, bob)).body.user.statistics.reviews, 0);
  assert.equal((await call('/publications?animeId=mal:21&kind=post', bob)).body.total, 1);
  assert.equal((await call('/publications?animeId=mal:21&kind=review', bob)).body.total, 0);
  const stats = (await call('/anime/mal:20', bob)).body.anime.statistics;
  assert.equal(stats.ratingCount, 0); assert.equal(stats.reviewCount, 0); assert.equal(stats.averageRating, null);
  assert.equal((await call('/posts', alice, 'POST', { text: 'Duplicados', animeIds: ['mal:20', 'mal:20'] }, 'social-bad-000001')).status, 400);
  assert.equal((await call('/posts', alice, 'POST', { text: 'Puntuar un post', rating: 4 }, 'social-bad-000002')).status, 400);
  assert.equal((await call('/posts', alice, 'POST', { text: 'Autor falso', userId: bob.user.id }, 'social-bad-000003')).status, 400);
  assert.equal((await call('/posts', alice, 'POST', { text: '  ' }, 'social-bad-000004')).status, 400);
  assert.equal((await call('/posts', alice, 'POST', input)).status, 400);
});

test('seguimientos idempotentes, amigos recíprocos y feed de cuentas seguidas', async () => {
  const created = await call('/reviews', alice, 'POST', { animeId: 'mal:20', rating: 4,
    text: 'Una opinión que sí tiene estrellas.' }, 'social-review-0001');
  assert.equal(created.status, 201); reviewId = created.body.publication.id;
  assert.equal((await call('/posts', carol, 'POST', { text: 'Post de una cuenta no seguida' }, 'social-carol-0001')).status, 201);
  assert.equal((await call('/feed?type=following', bob)).body.total, 0);
  assert.equal((await call(`/me/following/${alice.user.id}`, alice, 'PUT')).status, 400);
  assert.equal((await call('/me/following/no-existe', bob, 'PUT')).status, 404);
  const follows = await Promise.all([
    call(`/me/following/${alice.user.id}`, bob, 'PUT'), call(`/me/following/${alice.user.id}`, bob, 'PUT'),
  ]);
  for (const response of follows) assert.equal(response.status, 200);
  assert.equal(await db.follow.count(), 1);
  assert.equal((await call(`/users/${alice.user.id}`, bob)).body.user.isFriend, false);
  assert.equal((await call(`/me/following/${bob.user.id}`, alice, 'PUT')).body.isFriend, true);
  const friends = (await call(`/users/${bob.user.id}/friends`, bob)).body;
  assert.equal(friends.total, 1); assert.equal(friends.items[0].id, alice.user.id);
  const first = (await call('/feed?type=following&limit=1', bob)).body;
  assert.equal(first.total, 2); assert.equal(first.items[0].id, reviewId);
  const second = (await call(`/feed?type=following&limit=1&cursor=${first.nextCursor}`, bob)).body;
  assert.equal(second.items[0].id, postId); assert.equal(second.nextCursor, null);
  assert.equal((await call(`/feed?type=following&cursor=${first.nextCursor}`, carol)).status, 400);
  assert.equal((await call('/feed?type=for-you', bob)).status, 200);
  assert.equal((await call(`/users/${alice.user.id}/followers`, carol)).body.total, 1);
  assert.equal((await call(`/users/${bob.user.id}/following`, carol)).body.items[0].id, alice.user.id);
});

test('likes y comentarios pertenecen a cada publicación, no al anime; la edición los conserva', async () => {
  for (const id of [postId, reviewId]) {
    const responses = await Promise.all([
      call(`/publications/${id}/like`, bob, 'PUT'), call(`/publications/${id}/like`, bob, 'PUT'),
    ]);
    for (const response of responses) { assert.equal(response.status, 200); assert.equal(response.body.likeCount, 1); }
    assert.equal((await call(`/publications/${id}`, bob)).body.publication.likedByMe, true);
    assert.equal((await call(`/publications/${id}`, alice)).body.publication.likedByMe, false);
    const key = `social-comment-${id.padStart(4, '0')}`;
    const comment = await call(`/publications/${id}/comments`, bob, 'POST', { text: 'Me gustó tu publicación' }, key);
    assert.equal(comment.status, 201);
    assert.deepEqual((await call(`/publications/${id}/comments`, bob, 'POST', { text: 'Me gustó tu publicación' }, key)).body, comment.body);
    assert.equal((await call(`/publications/${id}/comments`, bob, 'POST', { text: 'Otro comentario' }, key)).status, 409);
  }
  const original = (await call(`/publications/${postId}`, alice)).body.publication;
  assert.equal((await call(`/posts/${postId}`, bob, 'PATCH', { text: 'Intento editar lo ajeno' })).status, 403);
  const edited = await call(`/posts/${postId}`, alice, 'PATCH', { text: 'Ahora hablo solo de #Naruto', animeIds: ['mal:20'] });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.publication.likeCount, 1); assert.equal(edited.body.publication.commentCount, 1);
  assert.equal(edited.body.publication.createdAt, original.createdAt); assert.ok(edited.body.publication.updatedAt);
  assert.deepEqual(edited.body.publication.animeIds, ['mal:20']);
  assert.equal((await call('/publications?animeId=mal:21', bob)).body.total, 0);
  const secondReview = await call('/reviews', alice, 'POST', { animeId: 'mal:20', rating: 5,
    text: 'Otra review de ese mismo anime.' }, 'social-review-0002');
  assert.equal(secondReview.body.publication.likeCount, 0); assert.equal(secondReview.body.publication.commentCount, 0);
  const editReview = await call(`/reviews/${reviewId}`, alice, 'PATCH', { rating: 3.5 });
  assert.equal(editReview.body.publication.likeCount, 1); assert.equal(editReview.body.publication.commentCount, 1);
  assert.equal((await call(`/reviews/${postId}`, alice, 'PATCH', { rating: 4 })).status, 404);
  assert.equal((await call(`/posts/${reviewId}`, alice, 'PATCH', { text: 'No es un post común' })).status, 404);
  assert.equal((await call(`/publications/${postId}/comments`, bob, 'POST', { text: '  ' }, 'social-empty-0001')).status, 400);
  assert.equal((await call(`/publications/${postId}/comments`, bob, 'POST', { text: 'Falso', userId: alice.user.id }, 'social-forged-001')).status, 400);
  assert.equal((await call('/publications/999999/like', bob, 'PUT')).status, 404);
  assert.equal((await call('/publications/999999/comments', bob)).status, 404);
  assert.equal((await call('/publications/999999/comments', bob, 'POST', { text: 'Hola' }, 'social-missing-01')).status, 404);
  assert.equal((await call(`/publications/${postId}/like`, bob, 'DELETE')).body.likeCount, 0);
  assert.equal((await call(`/publications/${postId}/like`, bob, 'DELETE')).body.likeCount, 0);
  assert.equal((await call(`/publications/${reviewId}`, bob)).body.publication.likeCount, 1);
  await call(`/publications/${postId}/comments`, carol, 'POST', { text: 'Otro comentario de otra cuenta' }, 'social-comment-c1');
  const page = (await call(`/publications/${postId}/comments?limit=1`, bob)).body;
  assert.equal(page.total, 2); assert.equal(page.items[0].userId, carol.user.id);
  const next = (await call(`/publications/${postId}/comments?limit=1&cursor=${page.nextCursor}`, alice)).body;
  assert.equal(next.items[0].userId, bob.user.id); assert.equal(next.nextCursor, null);
  assert.equal((await call(`/publications/${reviewId}/comments?cursor=${page.nextCursor}`, bob)).status, 400);
  assert.equal((await call(`/publications/${postId}/like`, undefined, 'PUT')).status, 401);
});

test('perfil editable solo propio y sin exponer credenciales', async () => {
  const changed = await call('/me/profile', alice, 'PATCH', { name: 'Alice Ani', bio: 'Me gusta el anime', avatarUrl: 'https://images.example/avatar.png' });
  assert.equal(changed.status, 200);
  const profile = (await call(`/users/${alice.user.id}`, bob)).body.user;
  assert.equal(profile.name, 'Alice Ani'); assert.equal(profile.bio, 'Me gusta el anime');
  assert.equal(profile.avatarUrl, 'https://images.example/avatar.png');
  assert.equal(profile.statistics.posts, 1); assert.equal(profile.statistics.reviews, 2);
  assert.equal(profile.statistics.watched, 1); assert.equal(profile.statistics.friends, 1);
  assert.equal('passwordHash' in profile, false);
  assert.equal((await call(`/publications/${postId}`, bob)).body.publication.author.name, 'Alice Ani');
  for (const input of [{}, { name: ' ' }, { userId: bob.user.id }, { handle: 'otro' }, { bio: 'x'.repeat(501) }, { avatarUrl: 'file:///local.png' }, { avatarUrl: 'https://user:pass@example.com/a.png' }]) {
    assert.equal((await call('/me/profile', alice, 'PATCH', input)).status, 400);
  }
  assert.equal((await call(`/users/${bob.user.id}`, alice)).body.user.name, 'SocialBob');
});

test('watchlist y favoritos ordenados no generan vistos; reemplazo y permisos preservan biblioteca', async () => {
  assert.equal((await call('/me/library/mal:20', bob, 'PATCH', { watchlist: true })).status, 200);
  assert.equal((await call('/me/library/mal:21', bob, 'PATCH', { watchlist: true })).status, 200);
  assert.equal((await call('/me/library', bob)).body.total, 0);
  const watchlist = (await call('/me/library?collection=watchlist&limit=1', bob)).body;
  assert.equal(watchlist.total, 2);
  assert.equal((await call(`/users/${bob.user.id}`, alice)).body.user.statistics.watchlist, 2);
  assert.equal((await call(`/me/library?cursor=${watchlist.nextCursor}`, bob)).status, 400);
  const input = { animeIds: ['mal:21', 'mal:20'] };
  const first = await call('/me/favorites', bob, 'PUT', input);
  assert.equal(first.status, 200); assert.deepEqual(first.body.items.map((entry: any) => entry.anime.id), input.animeIds);
  assert.deepEqual((await call('/me/favorites', bob, 'PUT', input)).body, first.body);
  const reversed = await call('/me/favorites', bob, 'PUT', { animeIds: ['mal:20', 'mal:21'] });
  assert.equal(reversed.status, 200); assert.equal(reversed.body.items[0].anime.id, 'mal:20');
  assert.equal((await call('/me/favorites', alice)).body.total, 0);
  assert.equal((await call(`/users/${bob.user.id}`, alice)).body.user.favorites[0].anime.id, 'mal:20');
  assert.equal((await call('/me/library', bob)).body.total, 0);
  assert.equal((await call('/me/favorites', bob, 'PUT', { animeIds: ['mal:20', 'mal:20'] })).status, 400);
  assert.equal((await call('/me/favorites', bob, 'PUT', { animeIds: [], userId: alice.user.id })).status, 400);
  offline = true;
  try {
    assert.equal((await call('/me/favorites', bob, 'PUT', { animeIds: ['mal:20', 'mal:999'] })).status, 503);
    assert.equal((await call('/me/favorites', bob)).body.total, 2);
  } finally { offline = false; }
  await db.$executeRawUnsafe(`CREATE TRIGGER test_reject_favorite BEFORE UPDATE ON LibraryEntry
    WHEN NEW.favoritePosition = 1 BEGIN SELECT RAISE(ABORT, 'test failure'); END;`);
  try {
    assert.equal((await call('/me/favorites', bob, 'PUT', input)).status, 500);
    assert.deepEqual((await call('/me/favorites', bob)).body, reversed.body);
  } finally { await db.$executeRawUnsafe('DROP TRIGGER test_reject_favorite'); }
  assert.equal((await call('/me/library/mal:20', bob, 'PATCH', { watched: true })).status, 200);
  assert.equal((await call('/me/library/mal:20', bob, 'PATCH', { watchlist: false })).body.watched, true);
  assert.equal((await call('/me/library/mal:20', bob, 'PATCH', { watched: false })).status, 200);
  assert.equal((await call('/me/favorites', bob, 'PUT', { animeIds: [] })).body.total, 0);
  assert.equal((await call('/me/library?collection=watchlist', bob)).body.total, 1);
  assert.equal((await call('/me/library', bob)).body.total, 0);
  assert.equal((await call('/me/anime/mal:20/activity', bob)).body.total, 0);
});

test('datos sociales sobreviven reinicio y funcionan con proveedor caído', async () => {
  await stop(); await start(); offline = true;
  try {
    const publication = (await call(`/publications/${reviewId}`, bob)).body.publication;
    assert.equal(publication.anime.id, 'mal:20');
    assert.ok(publication.anime.title);
    assert.equal(publication.likeCount, 1); assert.equal(publication.commentCount, 1); assert.equal(publication.likedByMe, true);
    assert.equal((await call('/feed?type=following', bob)).body.total, 3);
    assert.equal((await call('/posts', bob, 'POST', { text: 'Publico sin catálogo externo' }, 'social-offline-01')).status, 201);
    assert.equal((await call('/posts', bob, 'POST', { text: 'Menciono anime ya guardado', animeIds: ['mal:20'] }, 'social-offline-02')).status, 201);
    assert.equal((await call('/posts', bob, 'POST', { text: 'Anime no disponible', animeIds: ['mal:999'] }, 'social-offline-03')).status, 503);
    assert.equal((await call(`/me/following/${alice.user.id}`, bob, 'DELETE')).body.isFriend, false);
    assert.equal((await call(`/me/following/${alice.user.id}`, bob, 'DELETE')).status, 200);
    assert.equal((await call('/feed?type=following', bob)).body.total, 0);
    assert.equal((await call(`/users/${alice.user.id}/friends`, bob)).body.total, 0);
    assert.equal((await call(`/publications/${reviewId}`, bob)).body.publication.likeCount, 1);
  } finally { offline = false; }
});

test('SQLite impide reviews sin voto, posteos con voto y seguimientos propios', async () => {
  await assert.rejects(db.publication.create({ data: { userId: alice.user.id, kind: 'review', text: 'Sin valoración' } }));
  await assert.rejects(db.publication.create({ data: { userId: alice.user.id, kind: 'otro', text: 'Tipo inválido' } }));
  await assert.rejects(db.follow.create({ data: { followerId: alice.user.id, followedId: alice.user.id } }));
  const rating = await db.ratingEntry.create({ data: { userId: alice.user.id, animeId: 'mal:20', rating: 4 } });
  await assert.rejects(db.publication.create({ data: { userId: alice.user.id, kind: 'post', ratingEntryId: rating.id, text: 'No corresponde' } }));
  assert.deepEqual(await db.$queryRawUnsafe('PRAGMA foreign_key_check'), []);
});
