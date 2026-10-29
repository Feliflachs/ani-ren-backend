import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture } from './fixture';
import { seedWorld, WORLD_VERSION } from '../scripts/demo/world';
import { anime } from '../scripts/demo/data';
import { ensureAnime } from '../src/modules/catalog/catalog';

test('world seed preserves personal data, populates geographic activity and can run twice', async () => {
  const f=await fixture();
  try {
    const personal=await f.account('real_account');
    const before=await f.db.user.findUniqueOrThrow({where:{id:personal.id}});
    for(const id of Object.values(anime))await ensureAnime(f.db,f.catalog,id);
    await f.db.avatar.create({data:{id:'fern',collection:'Frieren',name:'Fern',imageUrl:'/media/avatars/fern.png',sourceUrl:'https://example.org'}});
    const first=await seedWorld(f.db,f.catalog,()=>{},4);
    assert.equal(first.users,4);assert.equal(first.reviews,16);assert.equal(first.posts,8);assert.equal(first.ratings,28);assert.equal(first.countries,4);
    const profile=await f.db.user.findUniqueOrThrow({where:{id:`${WORLD_VERSION}_1`}});
    assert.equal(profile.avatarId,'fern');
    const pub=await f.db.publication.findFirstOrThrow({where:{userId:profile.id}});
    await f.db.publication.update({where:{id:pub.id},data:{text:'Manual edit preserved'}});
    const second=await seedWorld(f.db,f.catalog,()=>{},4);
    assert.equal(second.added,0);
    assert.equal(second.ratings,first.ratings);
    assert.equal(await f.db.session.count({where:{userId:{startsWith:WORLD_VERSION}}}),0);
    assert.equal((await f.db.publication.findUniqueOrThrow({where:{id:pub.id}})).text,'Manual edit preserved');
    assert.deepEqual(await f.db.user.findUniqueOrThrow({where:{id:personal.id}}),before);
    const map=await f.request('/explore/map?metric=reviews&period=all',personal);
    assert.equal(map.status,200);
    assert.ok(map.body.items.filter((r:{reviews:number})=>r.reviews>0).length>=4);
  } finally {await f.close();}
});
