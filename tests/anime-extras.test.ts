import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AniListExtras } from '../src/modules/catalog/anime-extras';
import { ApiError } from '../src/shared/errors';
import { fixture } from './fixture';

function payload() {
  return { data: { Media: { id: 20, idMal: 20,
    externalLinks: [
      { id: 1, url: 'https://example.com/watch', site: 'Streaming', language: 'Spanish', type: 'STREAMING', isDisabled: false },
      { id: 2, url: 'https://example.com/info', site: 'Info', language: null, type: 'INFO', isDisabled: false },
      { id: 3, url: 'javascript:alert(1)', site: 'Invalid', language: null, type: 'STREAMING', isDisabled: false },
      { id: 4, url: 'https://example.com/old', site: 'Old', language: null, type: 'STREAMING', isDisabled: true },
    ],
    characters: { pageInfo: { hasNextPage: true }, edges: [{ role: 'MAIN',
      node: { id: 1, name: { full: 'Naruto' }, image: { medium: null } },
      voiceActors: [{ id: 2, name: { full: 'Actor' }, image: null }],
    }] },
  } } };
}
test('AniList mapea por idMal, pagina personajes y no convierte idioma en disponibilidad regional', async () => {
  let calls = 0;
  const provider = new AniListExtras(async (url, options) => {
    calls++;
    assert.equal(url, 'https://graphql.anilist.co');
    assert.equal(options?.method, 'POST');
    const body = JSON.parse(String(options?.body));
    assert.deepEqual(body.variables, { idMal: 20, page: 2 });
    assert.match(body.query, /voiceActors\(language: JAPANESE\)/);
    return Response.json(payload());
  });
  const results = await Promise.all(Array.from({ length: 15 }, () => provider.get('mal:20', 2)));
  assert.equal(calls, 1);
  const result = results[0];
  assert.equal(result.regionalAvailability, 'unknown');
  assert.equal(result.streamingLinks.length, 1);
  assert.equal(result.streamingLinks[0].language, 'Spanish');
  assert.equal(result.characters[0].voiceActors[0].name, 'Actor');
  assert.equal(result.nextPage, 3);
  result.streamingLinks.length = 0;
  assert.equal((await provider.get('mal:20', 2)).streamingLinks.length, 1);
  assert.equal(calls, 1);
});

test('AniList distingue ausencia, GraphQL parcial, esquema inválido, ID incorrecto y fallos de red', async () => {
  const wrong = payload(); wrong.data.Media.idMal = 21;
  const cases: [() => Promise<Response>, string][] = [
    [async () => Response.json({ data: { Media: null } }), 'ANILIST_NOT_FOUND'],
    [async () => new Response('', { status: 404 }), 'ANILIST_NOT_FOUND'],
    [async () => Response.json({ ...payload(), errors: [{ message: 'private' }] }), 'ANILIST_GRAPHQL_ERROR'],
    [async () => Response.json({ data: {} }), 'ANILIST_INVALID_RESPONSE'],
    [async () => Response.json(wrong), 'ANILIST_INVALID_RESPONSE'],
    [async () => new Response('<html>'), 'ANILIST_INVALID_RESPONSE'],
    [async () => new Response('', { status: 500 }), 'ANILIST_ERROR'],
    [async () => { throw new DOMException('private', 'TimeoutError'); }, 'ANILIST_TIMEOUT'],
    [async () => { throw new Error('private'); }, 'ANILIST_UNAVAILABLE'],
  ];
  for (const [fetcher, code] of cases) {
    await assert.rejects(new AniListExtras(fetcher).get('mal:20'),
      (error: unknown) => error instanceof ApiError && error.code === code && !error.message.includes('private'));
  }
});

test('AniList bloquea nuevas peticiones tras 429 y permite recuperar respuestas inválidas', async () => {
  let calls = 0;
  const limited = new AniListExtras(async () => { calls++; return new Response('', { status: 429, headers: { 'Retry-After': '120' } }); });
  for (const id of ['mal:20', 'mal:21']) await assert.rejects(limited.get(id),
    (error: unknown) => error instanceof ApiError && error.code === 'ANILIST_RATE_LIMIT');
  assert.equal(calls, 1);
  let retries = 0;
  const recover = new AniListExtras(async () => Response.json(++retries === 1 ? {} : payload()));
  await assert.rejects(recover.get('mal:20'));
  assert.equal((await recover.get('mal:20')).anilistId, 20);
  assert.equal(retries, 2);
});

test('AniList permite datos opcionales vacíos y valida IDs y páginas antes de consultar', async () => {
  const data = payload(); data.data.Media.externalLinks = []; data.data.Media.characters.edges = [];
  data.data.Media.characters.pageInfo.hasNextPage = false;
  let calls = 0;
  const provider = new AniListExtras(async () => { calls++; return Response.json(data); });
  for (const [id, page] of [['mal:0', 1], ['mal:999999999999', 1], ['mal:20', 1001]] as const) {
    await assert.rejects(provider.get(id, page));
  }
  assert.equal(calls, 0);
  const result = await provider.get('mal:20');
  assert.deepEqual(result.characters, []);
  assert.deepEqual(result.streamingLinks, []);
  assert.equal(result.nextPage, null);
});

test('extras HTTP requiere sesión y funciona con Jikan caído sin guardar animes ni actividad', async () => {
  const f = await fixture(new AniListExtras(async () => Response.json(payload())));
  try {
    f.state.offline = true;
    assert.equal((await f.request('/anime/mal:20/extras')).status, 401);
    const user = await f.account('extras');
    const result = await f.request('/anime/mal:20/extras', user);
    assert.equal(result.status, 200);
    assert.equal(result.body.extras.animeId, 'mal:20');
    assert.equal((await f.request('/anime/mal:20/extras?country=AR', user)).status, 400);
    assert.equal((await f.request('/anime/mal:20/extras?page=0', user)).status, 400);
    assert.equal(f.state.catalogReads, 0);
    assert.equal(await f.db.anime.count(), 0);
    assert.equal(await f.db.publication.count(), 0);
  } finally { await f.close(); }
});
