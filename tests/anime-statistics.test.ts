import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { fixture } from './fixture';

test('card statistics use one current vote per person without opening anime details', async () => {
  const f = await fixture();
  try {
    const a = await f.account('CardScoresA');
    const b = await f.account('CardScoresB');
    for (const [account, rating] of [[a, 2], [a, 5], [b, 3]] as const) {
      assert.equal((await f.request('/ratings', account, { method: 'POST', key: randomUUID(),
        body: { animeId: 'mal:1', rating } })).status, 201);
    }
    const reads = f.state.catalogReads;
    const response = await f.request('/anime/statistics?ids=mal:1,mal:2,mal:1', a);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.items, [
      { id: 'mal:1', statistics: { averageRating: 4, ratingUserCount: 2 } },
      { id: 'mal:2', statistics: { averageRating: null, ratingUserCount: 0 } },
    ]);
    assert.equal(f.state.catalogReads, reads);
    assert.equal((await f.request('/anime/statistics?ids=invalid', a)).status, 400);
    assert.equal((await f.request('/anime/statistics?ids=mal:1')).status, 401);
  } finally { await f.close(); }
});
