import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import type { Server } from 'node:http';
import { PrismaClient } from '@prisma/client';
import { createApp } from '../src/app';
import type { AnimeMetadata, Catalog } from '../src/catalog';
import { ApiError } from '../src/errors';
import { hashToken } from '../src/security';

const testRoot = path.resolve('.test-data');
let directory: string;
let databaseUrl: string;
let db: PrismaClient;
let server: Server;
let baseUrl: string;
let alice: { token: string; user: { id: string } };
let bob: typeof alice;
let unavailable = false;
let catalogReads = 0;
const catalog: Catalog = {
  async get(id) {
    catalogReads++;
    if (unavailable) throw new ApiError(503, 'CATALOG_UNAVAILABLE', 'Catálogo no disponible.');
    return { id, externalId: Number(id.slice(4)), title: `Anime de prueba ${id}`,
      japanese: null, imageUrl: null, synopsis: null, episodes: null, year: null, season: null,
      genres: [{ id: 'mal:22', name: 'Romance' }],
    } satisfies AnimeMetadata;
  },
  async search(query, page) { return { items: [await this.get('mal:20')], nextPage: page === 1 ? 2 : null }; },
};

async function start() {
  db = new PrismaClient({ datasourceUrl: databaseUrl });
  const app = createApp({ db, catalog, corsOrigins: ['http://localhost:8081'], sessionDays: 7, timeZone: 'America/Buenos_Aires' });
  server = await new Promise<Server>((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  baseUrl = `http://127.0.0.1:${address.port}/api`;
}

async function stop() {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  });
  await db.$disconnect();
}

async function call(route: string, options: {
  method?: string; body?: unknown; token?: string; key?: string; headers?: Record<string, string>;
} = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    method: options.method ?? 'GET',
    headers: {
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.key ? { 'Idempotency-Key': options.key } : {}), ...options.headers,
    }, body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const body = response.status === 204 ? null : await response.json();
  return { status: response.status, body };
}

async function register(handle: string) {
  const body = { handle, password: 'Anime2026' };
  assert.equal((await call('/auth/register', { method: 'POST', body })).status, 201);
  const login = await call('/auth/login', { method: 'POST', body });
  assert.equal(login.status, 200);
  return login.body;
}

before(async () => {
  await mkdir(testRoot, { recursive: true });
  directory = await mkdtemp(path.join(testRoot, 'api-'));
  databaseUrl = `file:${path.join(directory, 'test.db').replaceAll('\\', '/')}`;
  // Aplicar la misma migración usada por la app, en una base nueva por ejecución.
  execFileSync(process.execPath, [path.resolve('scripts/prisma.cjs'), 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: 'pipe', windowsHide: true,
  });
  await start();
  alice = await register('Alice');
  bob = await register('Bob');
});

after(async () => {
  if (server) await stop();
  if (directory) {
    const target = path.resolve(directory);
    if (!target.startsWith(testRoot + path.sep)) throw new Error('Ruta de limpieza fuera del directorio de pruebas');
    await rm(target, { recursive: true, force: true });
  }
});

test('registro, normalización, sesión opaca y contraseñas protegidas', async () => {
  const duplicate = await call('/auth/register', { method: 'POST', body: { handle: ' ALICE ', password: 'Anime2026' } });
  assert.equal(duplicate.status, 409);
  assert.equal((await call('/auth/login', { method: 'POST', body: { handle: 'aLiCe', password: 'Anime2026' } })).status, 200);
  const wrong = await call('/auth/login', { method: 'POST', body: { handle: 'Alice', password: 'Incorrecta1' } });
  assert.equal(wrong.status, 401);
  const me = await call('/auth/me', { token: alice.token });
  assert.equal(me.body.user.id, alice.user.id);
  assert.equal('passwordHash' in me.body.user, false);
  assert.equal((await call('/auth/me')).status, 401);
  assert.equal((await call('/auth/me', { token: alice.user.id })).status, 401);
  const stored = await db.user.findUniqueOrThrow({ where: { id: alice.user.id } });
  assert.notEqual(stored.passwordHash, 'Anime2026');
  assert.match(stored.passwordHash, /^scrypt:/);
  assert.ok(await db.session.findUnique({ where: { tokenHash: hashToken(alice.token) } }));
  assert.equal(await db.session.findUnique({ where: { tokenHash: alice.token } }), null);
});

test('valorar varias veces cambia el promedio, no duplica vistos ni inventa reviews', async () => {
  const first = await call('/ratings', { method: 'POST', token: alice.token, key: 'naruto-rating-0001',
    body: { animeId: 'mal:20', rating: 3.5 } });
  assert.equal(first.status, 201);
  assert.equal(first.body.rating.publicationId, null);
  assert.equal((await call('/publications?animeId=mal:20', { token: bob.token })).body.total, 0);
  const second = await call('/reviews', { method: 'POST', token: alice.token, key: 'naruto-review-0002', body: {
    animeId: 'mal:20', rating: 4.5, text: 'Ahora me gustó mucho más #Naruto', watchedOn: '2020-02-29', rewatched: true,
  } });
  assert.equal(second.status, 201);
  assert.equal(second.body.publication.rewatched, true);
  assert.deepEqual(second.body.publication.tags, ['naruto']);
  const detail = await call('/anime/mal:20', { token: bob.token });
  assert.deepEqual(detail.body.anime.statistics, { averageRating: 4.5, ratingCount: 2, reviewCount: 1, ratingUserCount: 1 });
  const activity = await call('/me/anime/mal:20/activity', { token: alice.token });
  assert.equal(activity.body.currentRating.rating, 4.5);
  assert.equal(activity.body.total, 2);
  assert.equal((await call('/me/library', { token: alice.token })).body.total, 1);
  assert.equal((await call('/me/library', { token: bob.token })).body.total, 0);
  assert.equal(await db.libraryEntry.count({ where: { userId: alice.user.id, anime: { id: 'mal:20' } } }), 1);
});

test('editar estrellas conserva creación y actualiza el voto vigente', async () => {
  const activity = (await call('/me/anime/mal:20/activity', { token: alice.token })).body;
  const old = activity.items[1];
  const edited = await call(`/ratings/${old.id}`, { method: 'PATCH', token: alice.token, body: { rating: 2.5 } });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.rating.createdAt, old.createdAt);
  assert.ok(edited.body.rating.updatedAt);
  const stats = (await call('/anime/mal:20', { token: alice.token })).body.anime.statistics;
  assert.equal(stats.averageRating, 2.5);
  assert.equal(stats.ratingCount, 2);
  assert.equal((await call('/me/anime/mal:20/activity', { token: alice.token })).body.currentRating.rating, 2.5);
  const publication = (await call('/publications?animeId=mal:20', { token: alice.token })).body.items[0];
  const reviewEdit = await call(`/reviews/${publication.id}`, { method: 'PATCH', token: alice.token,
    body: { rating: 5, text: 'Opinión actualizada después de volver a verlo.' } });
  assert.equal(reviewEdit.status, 200);
  assert.equal(reviewEdit.body.publication.createdAt, publication.createdAt);
  assert.ok(reviewEdit.body.publication.updatedAt);
  assert.equal((await call('/anime/mal:20', { token: alice.token })).body.anime.statistics.averageRating, 5);
  assert.equal((await call(`/ratings/${publication.ratingEntryId}`, { method: 'PATCH', token: alice.token, body: { rating: 1 } })).status, 409);
});

test('autoría desde sesión y rechazo de cambios sobre recursos ajenos', async () => {
  const publication = (await call('/publications?animeId=mal:20', { token: bob.token })).body.items[0];
  assert.equal((await call(`/reviews/${publication.id}`, { method: 'PATCH', token: bob.token, body: { text: 'No me pertenece esta publicación.' } })).status, 403);
  assert.equal((await call('/ratings', { method: 'POST', token: bob.token, key: 'forged-user-00001',
    body: { animeId: 'mal:20', rating: 1, userId: alice.user.id } })).status, 400);
  const rating = await db.ratingEntry.findFirstOrThrow({ where: { userId: alice.user.id } });
  assert.equal((await call(`/ratings/${rating.id}`, { method: 'PATCH', token: bob.token, body: { rating: 1 } })).status, 403);
  assert.equal((await call('/reviews/999999', { method: 'PATCH', token: alice.token, body: { rating: 1 } })).status, 404);
});

test('reintentar no duplica; clave nueva crea otra review e interacciones podrán distinguirlas', async () => {
  const body = { animeId: 'mal:21', rating: 4, text: 'Una review con suficiente texto.' };
  const options = { method: 'POST', token: alice.token, key: 'review-retry-0001', body };
  const first = await call('/reviews', options);
  const again = await call('/reviews', options);
  assert.equal(first.status, 201);
  assert.deepEqual(again.body, first.body);
  const conflict = await call('/reviews', { ...options, body: { ...body, rating: 2 } });
  assert.equal(conflict.status, 409);
  const second = await call('/reviews', { ...options, key: 'review-retry-0002' });
  assert.notEqual(second.body.publication.id, first.body.publication.id);
  assert.equal((await call('/anime/mal:21', { token: alice.token })).body.anime.statistics.reviewCount, 2);
});

test('dos reintentos simultáneos conservan una única operación', async () => {
  // Precargar metadatos para concentrar la prueba en la transacción y su unicidad.
  await call('/anime/mal:22', { token: alice.token });
  const request = { method: 'POST', token: alice.token, key: 'concurrent-000001',
    body: { animeId: 'mal:22', rating: 3, text: 'Review enviada en paralelo por un reintento.' } };
  const [first, second] = await Promise.all([call('/reviews', request), call('/reviews', request)]);
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.equal(first.body.publication.id, second.body.publication.id);
  assert.equal(await db.ratingEntry.count({ where: { animeId: 'mal:22' } }), 1);
});

test('una transacción fallida no deja una valoración o un visto a medias', async () => {
  await call('/anime/mal:30', { token: alice.token });
  await db.$executeRawUnsafe(`CREATE TRIGGER test_reject_publication BEFORE INSERT ON Publication
    WHEN NEW.text = 'Forzar fallo de publicación' BEGIN SELECT RAISE(ABORT, 'test failure'); END;`);
  try {
    const failed = await call('/reviews', { method: 'POST', token: alice.token, key: 'rollback-case-0001',
      body: { animeId: 'mal:30', rating: 4, text: 'Forzar fallo de publicación' } });
    assert.equal(failed.status, 500);
    assert.equal(await db.ratingEntry.count({ where: { animeId: 'mal:30' } }), 0);
    assert.equal(await db.libraryEntry.count({ where: { animeId: 'mal:30' } }), 0);
    assert.equal(await db.operation.count({ where: { key: 'rollback-case-0001' } }), 0);
  } finally { await db.$executeRawUnsafe('DROP TRIGGER test_reject_publication'); }
});

test('validaciones estrictas, fechas reales, límites y restricción de estrellas en SQLite', async () => {
  for (const rating of [0, 5.5, 3.7, '4']) {
    assert.equal((await call('/ratings', { method: 'POST', token: alice.token, key: 'invalid-rating-01', body: { animeId: 'mal:20', rating } })).status, 400);
  }
  for (const watchedOn of ['2025-02-29', '2020-02-30', '9999-12-31', 'ayer']) {
    assert.equal((await call('/ratings', { method: 'POST', token: alice.token, key: 'invalid-date-001', body: { animeId: 'mal:20', rating: 4, watchedOn } })).status, 400);
  }
  assert.equal((await call('/reviews', { method: 'POST', token: alice.token, key: 'empty-review-001', body: { animeId: 'mal:20', rating: 4, text: '   ' } })).status, 400);
  assert.equal((await call('/ratings', { method: 'POST', token: alice.token, body: { animeId: 'mal:20', rating: 4 } })).status, 400);
  assert.equal((await call('/ratings', { method: 'POST', token: alice.token, key: 'invalid-bool-001', body: { animeId: 'mal:20', rating: 4, rewatched: 'false' } })).status, 400);
  await assert.rejects(db.ratingEntry.create({ data: { userId: alice.user.id, animeId: 'mal:20', rating: 3.7 } }));
  const malformed = await fetch(`${baseUrl}/ratings`, { method: 'POST', headers: { Authorization: `Bearer ${alice.token}`, 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(malformed.status, 400);
});

test('paginación estable con total real y cursor ligado al filtro', async () => {
  const first = await call('/publications?animeId=mal:21&limit=1', { token: alice.token });
  assert.equal(first.body.items.length, 1);
  assert.equal(first.body.total, 2);
  assert.ok(first.body.nextCursor);
  const second = await call(`/publications?animeId=mal:21&limit=1&cursor=${first.body.nextCursor}`, { token: alice.token });
  assert.equal(second.body.total, 2);
  assert.notEqual(first.body.items[0].id, second.body.items[0].id);
  assert.equal(second.body.nextCursor, null);
  assert.equal((await call(`/publications?animeId=mal:20&cursor=${first.body.nextCursor}`, { token: alice.token })).status, 400);
  assert.equal((await call('/publications?limit=999', { token: alice.token })).status, 400);
});

test('visto sin review y temporadas diferentes conservan IDs independientes', async () => {
  for (const animeId of ['mal:100', 'mal:101']) {
    assert.equal((await call(`/me/library/${animeId}`, { method: 'PATCH', token: bob.token, body: { watched: true } })).status, 200);
  }
  await call('/me/library/mal:100', { method: 'PATCH', token: bob.token, body: { watched: true } });
  const library = (await call('/me/library', { token: bob.token })).body;
  assert.equal(library.total, 2);
  assert.deepEqual(library.items.map((item: { anime: { id: string } }) => item.anime.id).sort(), ['mal:100', 'mal:101']);
  assert.equal((await call(`/publications?userId=${bob.user.id}`, { token: alice.token })).body.total, 0);
  assert.equal((await call('/anime/mal:100', { token: bob.token })).body.anime.statistics.averageRating, null);
  assert.equal((await call('/me/library/mal:100', { method: 'PATCH', token: bob.token, body: { watched: false } })).status, 400);
});

test('un proveedor caído no pierde reviews; metadatos anteriores se identifican como desactualizados', async () => {
  await db.anime.update({ where: { id: 'mal:20' }, data: { fetchedAt: new Date('2000-01-01') } });
  unavailable = true;
  try {
    const previousReads = catalogReads;
    const detail = await call('/anime/mal:20', { token: bob.token });
    assert.equal(detail.status, 200);
    assert.equal(detail.body.anime.metadataStale, true);
    assert.ok(catalogReads > previousReads);
    assert.equal((await call('/anime/mal:999', { token: bob.token })).status, 503);
    assert.equal((await call('/publications?animeId=mal:20', { token: bob.token })).body.total, 1);
  } finally { unavailable = false; }
});

test('base y sesión sobreviven al cierre y apertura del servidor con un cliente Prisma nuevo', async () => {
  const beforeRestart = (await call('/publications', { token: alice.token })).body;
  await stop();
  await start();
  assert.equal((await call('/auth/me', { token: alice.token })).status, 200);
  const afterRestart = (await call('/publications', { token: bob.token })).body;
  assert.deepEqual(afterRestart, beforeRestart);
  assert.equal((await call('/me/anime/mal:20/activity', { token: alice.token })).body.currentRating.rating, 5);
});

test('sesiones vencidas y revocadas no autorizan operaciones', async () => {
  const extra = await call('/auth/login', { method: 'POST', body: { handle: 'Alice', password: 'Anime2026' } });
  await db.session.update({ where: { tokenHash: hashToken(extra.body.token) }, data: { expiresAt: new Date(0) } });
  assert.equal((await call('/auth/me', { token: extra.body.token })).status, 401);
  const temporary = await call('/auth/login', { method: 'POST', body: { handle: 'Bob', password: 'Anime2026' } });
  assert.equal((await call('/auth/logout', { method: 'POST', token: temporary.body.token })).status, 204);
  assert.equal((await call('/publications', { token: temporary.body.token })).status, 401);
  assert.equal((await call('/auth/me', { token: bob.token })).status, 200);
});

test('CORS explícito, respuestas privadas y límite de intentos de autenticación', async () => {
  assert.equal((await call('/health', { headers: { Origin: 'http://sitio-ajeno.test' } })).status, 403);
  assert.equal((await call('/health', { headers: { Origin: 'http://localhost:8081' } })).status, 200);
  const response = await fetch(`${baseUrl}/auth/me`, { headers: { Authorization: `Bearer ${alice.token}` } });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  let limited = false;
  for (let index = 0; index < 21; index++) {
    const attempt = await call('/auth/login', { method: 'POST', body: {} });
    if (attempt.status === 429) { limited = true; break; }
  }
  assert.equal(limited, true);
});
