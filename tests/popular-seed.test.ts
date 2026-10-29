import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fixture} from './fixture';
import {ensureAnime} from '../src/modules/catalog/catalog';
import {seedPopular} from '../scripts/demo/popular';
test('popular reviews add high ratings only to demo accounts and repeated runs preserve edits',async()=>{
  const f=await fixture();
  try {
    const personal=await f.account('personal');
    for(const id of ['mal:21','mal:20','mal:52991','mal:16498'])await ensureAnime(f.db,f.catalog,id);
    await f.db.user.create({data:{id:'aniren_demo_v1_lucas',handle:'demo_lucas',normalizedHandle:'demo_lucas',name:'Lucas',passwordHash:'test'}});
    const first=await seedPopular(f.db,f.catalog,()=>{});
    assert.equal(first.added,4);assert.ok(first.fiveStars>=3);
    const review=await f.db.publication.findFirstOrThrow();
    await f.db.publication.update({where:{id:review.id},data:{text:'Manual'}});
    const second=await seedPopular(f.db,f.catalog,()=>{});
    assert.equal(second.added,0);assert.equal(second.skipped,4);
    assert.equal((await f.db.publication.findUniqueOrThrow({where:{id:review.id}})).text,'Manual');
    assert.equal(await f.db.ratingEntry.count({where:{userId:personal.id}}),0);
    assert.equal(await f.db.libraryEntry.count({where:{userId:review.userId,watched:true}}),4);
    assert.equal(await f.db.ratingEntry.count({where:{countryCode:'AR'}}),4);
    assert.equal(await f.db.session.count({where:{userId:review.userId}}),0);
  }finally{await f.close();}
});
