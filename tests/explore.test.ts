import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { fixture } from './fixture';

test('valoraciones por país: reintentos no duplican vistas; ediciones conservan país y actualizan puntaje', async () => {
  const f = await fixture();
  try {
    const a = await f.account('MapA'); const b = await f.account('MapB');
    const key = randomUUID(); const body = { animeId: 'mal:1', rating: 5, countryCode: 'ar' };
    const rating = (await f.request('/ratings', a, { method: 'POST', key, body })).body.rating;
    await f.request('/ratings', a, { method: 'POST', key, body });
    await f.request('/reviews', b, { method: 'POST', key: randomUUID(), body: { animeId: 'mal:1', rating: 3, countryCode: 'AR', text: 'Mi review desde Argentina.' } });
    await f.request('/ratings', a, { method: 'POST', key: randomUUID(), body: { animeId: 'mal:2', rating: 4, countryCode: 'JP' } });
    await f.request('/ratings', a, { method: 'POST', key: randomUUID(), body: { animeId: 'mal:3', rating: 2 } });
    let map = (await f.request('/explore/map', a)).body;
    assert.equal(map.unknownCountryViews, 1);
    const ar = map.items.find((row: any) => row.code === 'AR');
    assert.equal(ar.views, 2); assert.equal(ar.averageRating, 4); assert.equal(ar.reviews, 1); assert.equal(ar.intensity, 1); assert.equal(ar.colorLevel, 5);
    assert.equal(map.items.find((row: any) => row.code === 'JP').intensity, 0.5);
    assert.equal(map.items.find((row: any) => row.code === 'IS').colorLevel, 0);
    assert.equal((await f.request('/ratings/' + rating.id, a, { method: 'PATCH', body: { rating: 1 } })).status, 200);
    const country = (await f.request('/explore/countries/argentina', a)).body;
    assert.equal(country.statistics.views, 2); assert.equal(country.statistics.averageRating, 2);
    assert.equal(country.topRated[0].anime.id, 'mal:1'); assert.equal(country.trending[0].views, 2);
    assert.equal(country.topViewed[0].anime.id, 'mal:1');
    assert.equal(country.topReviewed[0].anime.id, 'mal:1');
    assert.equal(country.topReviewed[0].reviews, 1);
    const emptyCountry = (await f.request('/explore/countries/IS', a)).body;
    assert.deepEqual(emptyCountry.topViewed, []); assert.deepEqual(emptyCountry.topReviewed, []);
    const otherAnime = (await f.request('/explore/countries/AR?animeId=mal:2', a)).body;
    assert.deepEqual(otherAnime.topViewed, []);
    assert.equal((await f.request('/explore/countries/AR/reviews', a)).body.total, 1);
    assert.equal((await f.request('/explore/map?metric=anime&animeId=mal:1', a)).body.items[0].code, 'AR');
    assert.equal((await f.request('/explore/map?metric=anime', a)).status, 400);
    assert.equal((await f.request('/ratings/' + rating.id, a, { method: 'PATCH', body: { countryCode: 'JP' } })).status, 400);
    for (const countryCode of ['XX', 'Argentina', 'ZZ']) assert.equal((await f.request('/ratings', a, { method: 'POST', key: randomUUID(), body: { animeId: 'mal:1', rating: 5, countryCode } })).status, 400);
    assert.equal((await f.request('/ratings', a, { method: 'POST', key: randomUUID(), body: { animeId: 'mal:1', rating: 5, latitude: 10 } })).status, 400);
    await f.restart(); f.state.offline = true;
    map = (await f.request('/explore/map?metric=reviews', a)).body;
    assert.equal(map.items[0].code, 'AR'); assert.equal(map.items[0].value, 1);
    assert.equal((await f.request('/explore/map')).status, 401);
  } finally { await f.close(); }
});

test('tops usan período real, género y voto vigente; tendencias regionales solo últimos siete días', async () => {
  const f = await fixture();
  try {
    const a = await f.account('TopsA'); const b = await f.account('TopsB');
    for (const [user, id, rating] of [[a, 'mal:1', 5], [b, 'mal:1', 3], [a, 'mal:4', 4.5]] as const) await f.request('/ratings', user, { method: 'POST', key: randomUUID(), body: { animeId: id, rating, countryCode: 'AR' } });
    await f.db.ratingEntry.updateMany({ where: { animeId: 'mal:4' }, data: { createdAt: new Date(Date.now() - 40 * 86_400_000) } });
    const week = (await f.request('/explore/tops?criterion=rating&period=week', a)).body;
    assert.equal(week.total, 1); assert.equal(week.items[0].averageRating, 4);
    const all = (await f.request('/explore/tops?criterion=rating&period=all&limit=1', a)).body;
    assert.equal(all.items[0].anime.id, 'mal:4'); assert.equal(all.total, 2);
    assert.equal((await f.request('/explore/tops?criterion=views&period=all&cursor=' + all.nextCursor, a)).status, 400);
    assert.equal((await f.request('/explore/tops?period=all&genre=mal:22', a)).body.total, 1);
    const country = (await f.request('/explore/countries/AR', a)).body;
    assert.equal(country.topRated[0].anime.id, 'mal:4'); assert.equal(country.trending.length, 1); assert.equal(country.trending[0].anime.id, 'mal:1');
    assert.deepEqual(country.topViewed.map((row: any) => row.anime.id), ['mal:1', 'mal:4']);
    assert.deepEqual(country.topReviewed, []);
    const home = (await f.request('/explore', a)).body;
    assert.equal(home.trending[0].anime.id, 'mal:1'); assert.equal(home.seasons.length, 4);
    assert.ok(home.genres.some((genre: any) => genre.id === 'mal:24'));
  } finally { await f.close(); }
});
