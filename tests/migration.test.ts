import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

test('migrar una base del primer bloque conserva reviews, historial, sesiones y respuestas guardadas', async () => {
  const root = path.resolve('.test-data');
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, 'migration-'));
  const databaseUrl = `file:${path.join(directory, 'old.db').replaceAll('\\', '/')}`;
  const db = new PrismaClient({ datasourceUrl: databaseUrl });
  const deploy = (schema: string) => execFileSync(process.execPath,
    [path.resolve('scripts/prisma.cjs'), 'migrate', 'deploy', '--schema', schema],
    { env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: 'pipe', windowsHide: true });
  try {
    // Instalar únicamente la migración histórica, como una base previa a este bloque.
    const migrations = path.join(directory, 'migrations');
    await mkdir(path.join(migrations, '202610110001_initial'), { recursive: true });
    await copyFile('prisma/migrations/migration_lock.toml', path.join(migrations, 'migration_lock.toml'));
    await copyFile('prisma/migrations/202610110001_initial/migration.sql', path.join(migrations, '202610110001_initial/migration.sql'));
    await copyFile('prisma/schema.prisma', path.join(directory, 'schema.prisma'));
    deploy(path.join(directory, 'schema.prisma'));
    await db.$executeRaw`INSERT INTO User (id, handle, normalizedHandle, passwordHash, name)
      VALUES ('old-user', 'OldUser', 'olduser', 'hash-de-prueba', 'Usuario previo')`;
    await db.$executeRaw`INSERT INTO Anime (id, externalId, title, genres) VALUES ('mal:20', 20, 'Naruto', '[]')`;
    await db.$executeRaw`INSERT INTO RatingEntry (id, userId, animeId, rating, watchedOn, rewatched)
      VALUES (41, 'old-user', 'mal:20', 3.5, '2020-02-29', true), (42, 'old-user', 'mal:20', 4.5, null, false)`;
    await db.$executeRaw`INSERT INTO Publication (id, userId, ratingEntryId, text, title, spoiler, createdAt, updatedAt)
      VALUES (17, 'old-user', 42, 'Review que debe conservarse #Naruto', 'Título previo', true,
        '2026-01-01T12:00:00.000Z', '2026-02-01T12:00:00.000Z')`;
    await db.$executeRaw`INSERT INTO LibraryEntry (userId, animeId, watched) VALUES ('old-user', 'mal:20', true)`;
    await db.$executeRaw`INSERT INTO Session (tokenHash, userId, expiresAt) VALUES ('old-token-hash', 'old-user', '2030-01-01T00:00:00.000Z')`;
    await db.$executeRaw`INSERT INTO Operation (userId, key, fingerprint, response)
      VALUES ('old-user', 'old-operation-01', 'old-fingerprint', '{"publication":{"id":"17"}}')`;
    await db.$disconnect();
    // Simular también los reclamos de misiones previos al sistema de puntos.
    for (const name of ['202610110002_social', '202610110003_discovery', '202610120001_missions', '202610180001_current_rating']) {
      await mkdir(path.join(migrations, name), { recursive: true });
      await copyFile(`prisma/migrations/${name}/migration.sql`, path.join(migrations, name, 'migration.sql'));
    }
    deploy(path.join(directory, 'schema.prisma'));
    await db.$executeRaw`INSERT INTO MissionClaim (userId, missionId, rewardId, rewardName, rulesVersion)
      VALUES ('old-user', 'primera', 'primer-capitulo', 'Primer capítulo', '1')`;
    await db.$disconnect();
    deploy(path.resolve('prisma/schema.prisma'));
    const publication = await db.publication.findUniqueOrThrow({ where: { id: 17 } });
    assert.equal(publication.kind, 'review'); assert.equal(publication.ratingEntryId, 42);
    assert.equal(publication.text, 'Review que debe conservarse #Naruto');
    assert.equal(publication.title, 'Título previo'); assert.equal(publication.spoiler, true);
    assert.equal(publication.createdAt.toISOString(), '2026-01-01T12:00:00.000Z');
    assert.equal(publication.updatedAt?.toISOString(), '2026-02-01T12:00:00.000Z');
    const ratings = await db.ratingEntry.aggregate({ _avg: { rating: true }, _count: true });
    assert.equal(ratings._avg.rating, 4); assert.equal(ratings._count, 2);
    const library = await db.libraryEntry.findFirstOrThrow();
    assert.equal(library.currentRatingId, 42);
    assert.equal((await db.missionClaim.findFirstOrThrow()).points, 0);
    assert.equal((await db.ratingEntry.findFirstOrThrow()).countryCode, null);
    assert.equal((await db.user.findFirstOrThrow()).avatarUrl, null);
    assert.deepEqual((await db.anime.findFirstOrThrow()).studios, []);
    assert.equal(library.watched, true); assert.equal(library.watchlist, false); assert.equal(library.favoritePosition, null);
    assert.equal(await db.session.count(), 1);
    assert.deepEqual((await db.operation.findFirstOrThrow()).response, { publication: { id: '17' } });
    const post = await db.publication.create({ data: { userId: 'old-user', kind: 'post', text: 'Nuevo post' } });
    assert.ok(post.id > 17);
    await assert.rejects(db.ratingEntry.create({ data: { userId: 'old-user', animeId: 'mal:20', rating: 3.7 } }));
    assert.deepEqual(await db.$queryRawUnsafe('PRAGMA foreign_key_check'), []);
  } finally {
    await db.$disconnect();
    const target = path.resolve(directory);
    if (!target.startsWith(root + path.sep)) throw new Error('Directorio de pruebas inválido');
    await rm(target, { recursive: true, force: true });
  }
});
