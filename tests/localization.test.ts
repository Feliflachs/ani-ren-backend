import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TmdbStreaming } from '../src/modules/streaming/tmdb';
import { cleanSynopsis, localizedJson, SynopsisLocalization } from '../src/modules/catalog/localization';
const identity = { titles: ['Trigun'], year: 1998, format: 'TV' };
const candidate = { id: 26453, name: 'Trigun', first_air_date: '1998-04-01', genre_ids: [16] };
test('sinopsis: selecciona solamente traducciones españolas de una identidad confirmada y reutiliza caché', async () => {
  let calls = 0;
  const tmdb = new TmdbStreaming('test', async input => {
    calls++;
    return Response.json(String(input).includes('/search/') ? { results: [candidate] } : { translations: [
      { iso_639_1: 'en', iso_3166_1: 'US', data: { overview: 'English' } },
      { iso_639_1: 'es', iso_3166_1: 'ES', data: { overview: 'España' } },
      { iso_639_1: 'es', iso_3166_1: 'AR', data: { overview: 'Castellano' } },
    ] });
  });
  assert.equal(await tmdb.spanishSynopsis(identity), 'Castellano');
  assert.equal(await tmdb.spanishSynopsis(identity), 'Castellano');
  assert.equal(calls, 2);
  assert.equal(await tmdb.spanishSynopsis({ ...identity, year: 2023 }), null);
});
test('sin traducción, con ambigüedad o caída del proveedor devuelve null sin bloquear la ficha', async () => {
  for (const translations of [[], [{ iso_639_1: 'en', iso_3166_1: 'US', data: { overview: 'English' } }]]) {
    const tmdb = new TmdbStreaming('test', async input => Response.json(String(input).includes('/search/') ? { results: [candidate] } : { translations }));
    assert.equal(await tmdb.spanishSynopsis(identity), null);
  }
  const tmdb = new TmdbStreaming('test', async () => { throw Error('offline'); });
  assert.equal(await tmdb.spanishSynopsis(identity), null);
  assert.equal(await new SynopsisLocalization({ get: async () => { throw Error(); } }, tmdb).get('mal:6'), null);
});
test('géneros antiguos y anidados se traducen sin modificar IDs ni textos de usuarios', () => {
  const value = { anime: { genres: [{ id: 'mal:1', name: 'Action' }, { id: 'mal:24', name: 'Sci-Fi' }], synopsis: 'Historia.\n\n[Written by MAL Rewrite]' }, text: 'Action' };
  const result = JSON.parse(JSON.stringify(value, localizedJson));
  assert.deepEqual(result.anime.genres, [{ id: 'mal:1', name: 'Acción' }, { id: 'mal:24', name: 'Ciencia ficción' }]);
  assert.equal(result.text, 'Action'); assert.equal(result.anime.synopsis, 'Historia.');
  assert.equal(cleanSynopsis('Written by MAL Rewrite aparece dentro del relato.'), 'Written by MAL Rewrite aparece dentro del relato.');
});
