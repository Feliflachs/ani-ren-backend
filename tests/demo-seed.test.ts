import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture } from './fixture';
import { seedDemo } from '../scripts/demo/seed';
import { DEMO_VERSION, personas } from '../scripts/demo/data';

test('20 cuentas accesibles, actividad coherente y segunda carga sin duplicar ni sobrescribir', async () => {
  const f = await fixture();
  try {
    const personal = await f.account('PersonalNoTocar');
    const before = await f.db.user.findUniqueOrThrow({ where: { id: personal.id } });
    const first = await seedDemo(f.db, f.catalog);
    assert.equal(first.counts.users, 20);
    assert.equal(first.counts.reviews, 39);
    assert.equal(first.counts.posts, 38);
    assert.equal(first.counts.ratings, 41);
    assert.equal(first.counts.comments, 44);
    assert.equal(first.counts.replies, 25);
    assert.equal(first.counts.follows, 57);
    assert.equal(first.counts.lists, 19);
    assert.ok(first.addedSteps > 300);
    const coldId = `${DEMO_VERSION}_nora`;
    assert.equal(await f.db.libraryEntry.count({ where: { userId: coldId } }), 0);
    assert.equal(await f.db.follow.count({ where: { followerId: coldId } }), 0);
    assert.equal(await f.db.publication.count({ where: { userId: coldId } }), 0);
    assert.equal(await f.db.session.count({ where: { userId: { in: personas.map(p => `${DEMO_VERSION}_${p.key}`) } } }), 0);
    const lucasId = `${DEMO_VERSION}_lucas`;
    const current = await f.db.libraryEntry.findUniqueOrThrow({ where: { userId_animeId: { userId: lucasId, animeId: 'mal:20' } }, include: { currentRating: true } });
    assert.equal(current.currentRating?.rating, 4.5);
    const post = await f.db.publication.findFirstOrThrow({ where: { userId: lucasId, kind: 'post' } });
    await f.db.publication.update({ where: { id: post.id }, data: { text: 'Edición manual que debe conservarse.' } });
    const points = await f.db.missionClaim.aggregate({ _sum: { points: true } });
    const second = await seedDemo(f.db, f.catalog);
    assert.deepEqual(second.counts, first.counts);
    assert.equal(second.anchor, first.anchor);
    assert.equal(second.addedSteps, 0);
    assert.equal(second.skippedSteps, first.addedSteps);
    assert.equal((await f.db.publication.findUniqueOrThrow({ where: { id: post.id } })).text, 'Edición manual que debe conservarse.');
    assert.deepEqual(await f.db.user.findUniqueOrThrow({ where: { id: personal.id } }), before);
    assert.deepEqual(await f.db.missionClaim.aggregate({ _sum: { points: true } }), points);
  } finally { await f.close(); }
});

test('una colisión de usuario aborta antes de poblar otras cuentas', async () => {
  const f = await fixture();
  try {
    await f.account('demo_lucas');
    await assert.rejects(seedDemo(f.db, f.catalog), /pertenece a otros datos/);
    assert.equal(await f.db.user.count(), 1);
    assert.equal(await f.db.anime.count(), 0);
  } finally { await f.close(); }
});
