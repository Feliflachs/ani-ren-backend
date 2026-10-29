import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture } from './fixture';

test('avatar catalog selection persists and rejects unavailable IDs without changing profile', async () => {
  const f = await fixture();
  try {
    const user = await f.account('avatar_tester');
    await f.db.avatar.createMany({ data: [
      { id: 'fern', name: 'Fern', collection: 'Frieren', imageUrl: '/media/avatars/fern.png', sourceUrl: 'https://example.org/fern' },
      { id: 'hidden', name: 'Hidden', collection: 'Frieren', imageUrl: '/media/avatars/hidden.png', sourceUrl: 'https://example.org', active: false },
    ] });
    assert.equal((await f.request('/avatars')).status, 401);
    const catalog = await f.request('/avatars', user);
    assert.deepEqual(catalog.body.items.map((r: {id: string}) => r.id), ['fern']);
    const selected = await f.request('/me/profile', user, { method: 'PATCH', body: { avatarId: 'fern' } });
    assert.equal(selected.status, 200);
    assert.equal(selected.body.user.avatarUrl, '/media/avatars/fern.png');
    for (const avatarId of ['hidden', 'not-real']) {
      assert.equal((await f.request('/me/profile', user, { method: 'PATCH', body: { name: 'Must not save', avatarId } })).status, 400);
    }
    const profile = (await f.request(`/users/${user.id}`, user)).body.user;
    assert.equal(profile.name, 'avatar_tester');
    assert.equal(profile.avatarId, 'fern');
    await f.restart();
    assert.equal((await f.request('/auth/me', user)).body.user.avatarId, 'fern');
    const reset = await f.request('/me/profile', user, { method: 'PATCH', body: { avatarId: null } });
    assert.equal(reset.body.user.avatarUrl, null);
    assert.equal(reset.body.user.avatarId, null);
  } finally { await f.close(); }
});
