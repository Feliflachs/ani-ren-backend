import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import type { Server } from 'node:http';
import { PrismaClient } from '@prisma/client';
import { createApp } from '../src/app';
import { ApiError } from '../src/shared/errors';
import type { Catalog } from '../src/modules/catalog/catalog';
import { hashToken } from '../src/modules/auth/security';
import type { AnimeExtrasProvider } from '../src/modules/catalog/anime-extras';

export type Account = { id: string; token: string };
export async function fixture(extras?: AnimeExtrasProvider) {
  const root = path.resolve('.test-data');
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, 'discovery-'));
  const datasourceUrl = `file:${path.join(directory, 'test.db').replaceAll('\\', '/')}`;
  execFileSync(process.execPath, [path.resolve('scripts/prisma.cjs'), 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: datasourceUrl }, stdio: 'pipe', windowsHide: true,
  });
  const db = new PrismaClient({ datasourceUrl });
  const state = { offline: false, catalogReads: 0 };
  const catalog: Catalog = {
    async get(id) {
      state.catalogReads++;
      if (state.offline) throw new ApiError(503, 'CATALOG_UNAVAILABLE', 'Catálogo de prueba desconectado.');
      const romance = id !== 'mal:4';
      return { id, externalId: Number(id.slice(4)), title: `Anime ${id}`, japanese: null, imageUrl: null,
        synopsis: null, episodes: 12, year: 2025, season: romance ? 'spring' : 'winter',
        genres: [{ id: romance ? 'mal:22' : 'mal:24', name: romance ? 'Romance' : 'Sci-Fi' }] };
    },
    async search(_query, page) { return { items: [await this.get('mal:1')], nextPage: page === 1 ? 2 : null }; },
    async browse(_query, page, filters) {
      const anime = await this.get(page === 1 ? 'mal:1' : 'mal:4');
      const matches = (!filters.genres || anime.genres.some(genre => filters.genres!.includes(genre.id))) &&
        (!filters.season || anime.season === filters.season) && (!filters.year || anime.year === filters.year);
      return { items: matches ? [anime] : [], nextPage: page === 1 ? 2 : null };
    },
  };
  let server: Server;
  let base: string;
  async function start() {
    const app = createApp({ db, catalog, extras, corsOrigins: ['http://localhost:8081'], sessionDays: 7, timeZone: 'America/Buenos_Aires' });
    server = await new Promise<Server>((resolve) => {
      const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    base = `http://127.0.0.1:${address.port}/api`;
  }
  async function stop() {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve()); server.closeAllConnections();
    });
    await db.$disconnect();
  }
  await start();
  return {
    db, state, catalog,
    async account(handle: string): Promise<Account> {
      const user = await db.user.create({ data: { handle, normalizedHandle: handle.toLowerCase(), name: handle, passwordHash: 'fixture-no-login' } });
      const token = randomBytes(32).toString('base64url');
      await db.session.create({ data: { tokenHash: hashToken(token), userId: user.id, expiresAt: new Date(Date.now() + 86_400_000) } });
      return { id: user.id, token };
    },
    async request(route: string, account?: Account, options: { method?: string; body?: unknown; key?: string } = {}) {
      const response = await fetch(base + route, { method: options.method ?? 'GET', headers: {
        ...(account ? { Authorization: `Bearer ${account.token}` } : {}),
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(options.key ? { 'Idempotency-Key': options.key } : {}),
      }, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
      return { status: response.status, body: response.status === 204 ? null : await response.json() };
    },
    async restart() { await stop(); await start(); },
    async close() {
      await stop();
      const target = path.resolve(directory);
      if (!target.startsWith(root + path.sep)) throw new Error('Directorio de prueba inválido');
      await rm(target, { recursive: true, force: true });
    },
  };
}
