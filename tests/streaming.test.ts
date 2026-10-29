import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TmdbStreaming } from '../src/modules/streaming/tmdb';
import { StreamingService } from '../src/modules/streaming/streaming';
import type { AnimeExtras } from '../src/modules/catalog/anime-extras';
import { fixture } from './fixture';
const identity = { titles: ['Anime correcto'], year: 2025, format: 'TV' };
const extras: AnimeExtras = { animeId: 'mal:1', source: 'anilist', anilistId: 1, fetchedAt: new Date().toISOString(), identity,
  regionalAvailability: 'unknown', characters: [], voiceActorLanguage: 'JAPANESE', page: 1, nextPage: null,
  streamingLinks: [{ id: 1, site: 'Enlace global', url: 'https://example.com/anime', language: 'Spanish' }] };
const match = { id: 10, name: 'Anime correcto', first_air_date: '2025-01-01', genre_ids: [16] };
const providers = { results: { AR: { link: 'https://www.themoviedb.org/tv/10/watch?locale=AR', flatrate: [{ provider_id: 1, provider_name: 'Plataforma A' }] },
  ES: { link: 'https://www.themoviedb.org/tv/10/watch?locale=ES', rent: [{ provider_id: 2, provider_name: 'Plataforma B' }] } } };

test('TMDB filtra país, año, animación y formato; comparte consultas y no expone credenciales', async () => {
  let reads = 0;
  const tmdb = new TmdbStreaming('secret-test', async (input, options) => {
    reads++; const url = new URL(String(input)); assert.equal(url.searchParams.has('api_key'), false);
    assert.equal((options?.headers as Record<string,string>).Authorization, 'Bearer secret-test');
    return Response.json(url.pathname.includes('/search/') ? { results: [match, { ...match, id: 20, first_air_date: '2020-01-01' }, { ...match, id: 30, genre_ids: [18] }] } : providers);
  });
  const [ar, es] = await Promise.all([tmdb.get('mal:1', identity, 'AR'), tmdb.get('mal:1', identity, 'ES')]);
  assert.equal(ar.status, 'regional'); assert.equal(ar.links[0].site, 'Plataforma A');
  assert.equal(es.links[0].site, 'Plataforma B'); assert.equal(es.links[0].offer, 'Alquiler');
  assert.equal(reads, 2); assert.equal((await tmdb.get('mal:1', identity, 'JP')).status, 'no_data');
  assert.equal(JSON.stringify(ar).includes('secret-test'), false);
});

test('TMDB no inventa correspondencias para títulos ambiguos, temporadas, año o formato desconocidos', async () => {
  const tmdb = new TmdbStreaming('test', async () => Response.json({ results: [match, { ...match, id: 11 }] }));
  assert.equal((await tmdb.get('mal:1', identity, 'AR')).status, 'unmatched');
  assert.equal((await tmdb.get('mal:1', { ...identity, titles: ['Anime correcto Season 2'] }, 'AR')).status, 'unmatched');
  const noNetwork = new TmdbStreaming('test', async () => { throw Error('No debe consultar'); });
  for (const incomplete of [undefined, { ...identity, year: null }, { ...identity, format: 'OVA' }])
    assert.equal((await noNetwork.get('mal:1', incomplete, 'AR')).status, 'unmatched');
});

test('fallo regional conserva enlaces generales; vacío confirmado no se presenta como fallo', async () => {
  const source = { get: async () => extras };
  const fallback = await new StreamingService(source, { get: async () => { throw Error('secret must not leak'); } }).get('mal:1', 'AR');
  assert.equal(fallback.status, 'general'); assert.equal(fallback.source, 'anilist');
  assert.equal(fallback.links.length, 1); assert.equal(JSON.stringify(fallback).includes('secret'), false);
  const empty = await new StreamingService(source, { get: async () => ({ status: 'no_data', links: [] }) }).get('mal:1', 'AR');
  assert.equal(empty.status, 'no_data'); assert.equal(empty.links.length, 0);
  assert.equal((await new StreamingService(source).get('mal:1')).status, 'general');
  assert.equal((await new StreamingService({ get: async () => { throw Error(); } }).get('mal:1', 'AR')).status, 'unavailable');
});

test('esquemas inválidos no contaminan caché y enlaces fuera de TMDB se rechazan', async () => {
  let invalid = true;
  const tmdb = new TmdbStreaming('test', async input => Response.json(new URL(String(input)).pathname.includes('/search/')
    ? invalid ? { broken: true } : { results: [match] }
    : providers));
  await assert.rejects(tmdb.get('mal:1', identity, 'AR')); invalid = false;
  assert.equal((await tmdb.get('mal:1', identity, 'AR')).status, 'regional');
  const unsafe = new TmdbStreaming('test', async input => Response.json(new URL(String(input)).pathname.includes('/search/')
    ? { results: [match] } : { results: { AR: { ...providers.results.AR, link: 'https://evil.example/watch' } } }));
  await assert.rejects(unsafe.get('mal:1', identity, 'AR'));
});

test('consultar ficha y cambiar país no crea vistos, valoraciones, biblioteca ni misiones', async () => {
  const f = await fixture({ get: async () => extras }, { get: async (_id, _identity, country) => ({ status: 'regional', links: [{ id: country, site: country, url: 'https://www.themoviedb.org/', offer: 'Suscripción' }] }) });
  try {
    const user = await f.account('Countries');
    assert.equal((await f.request('/anime/mal:1/streaming?country=AR')).status, 401);
    for (const country of ['AR', 'ES', 'JP', 'US']) {
      const result = await f.request('/anime/mal:1/streaming?country=' + country, user);
      assert.equal(result.status, 200); assert.equal(result.body.country.code, country); assert.equal(result.body.links[0].site, country);
    }
    assert.equal((await f.request('/anime/mal:1/streaming?country=ZZ', user)).status, 400);
    assert.equal((await f.request('/anime/mal:1/streaming?country=AR&latitude=1', user)).status, 400);
    assert.equal(await f.db.libraryEntry.count(), 0); assert.equal(await f.db.ratingEntry.count(), 0);
    assert.equal(await f.db.publication.count(), 0); assert.equal(await f.db.missionClaim.count(), 0);
    assert.equal(await f.db.anime.count(), 0);
  } finally { await f.close(); }
});

test('acepta API Key v3 sin devolverla al cliente', async () => {
  const tmdb = new TmdbStreaming('private-key', async (input, options) => {
    const url = new URL(String(input));
    assert.equal(url.searchParams.get('api_key'), 'private-key');
    assert.equal((options?.headers as Record<string,string>).Authorization, undefined);
    return Response.json(url.pathname.includes('/search/') ? { results: [match] } : providers);
  }, 'api-key');
  const result = await tmdb.get('mal:1', identity, 'AR');
  assert.equal(result.status, 'regional'); assert.equal(JSON.stringify(result).includes('private-key'), false);
});

test('películas usan búsqueda y proveedores de movie en lugar de tv', async () => {
  const paths: string[] = [];
  const tmdb = new TmdbStreaming('test', async input => {
    const url = new URL(String(input)); paths.push(url.pathname);
    if (url.pathname.includes('/search/')) {
      assert.equal(url.searchParams.get('primary_release_year'), '2025');
      return Response.json({ results: [{ id: 15, title: 'Anime correcto', release_date: '2025-01-01', genre_ids: [16] }] });
    }
    return Response.json(providers);
  });
  assert.equal((await tmdb.get('mal:2', { ...identity, format: 'MOVIE' }, 'AR')).status, 'regional');
  assert.deepEqual(paths, ['/3/search/movie', '/3/movie/15/watch/providers']);
});
