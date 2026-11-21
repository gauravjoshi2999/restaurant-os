'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const html = fs.readFileSync('index.html', 'utf8');
const match = html.match(/async function deleteMenuItem\(id\)\{[\s\S]*?\n\}/);
assert.ok(match, 'Owner menu delete implementation must be present');
async function run({agree = true, typed = 'Dal Fry', data = [{id:'item-a'}], error=null, rid='hotel-1',itemRid=rid,activeRid=rid,allowed=true}={}) {
  const calls = []; const notices = [];
  const query = {
    eq: (col,val)=>{calls.push(['eq',col,val]);return query;},
    select: async cols=>{calls.push(['select',cols]);return {data,error}},
  };
  const sandbox = {
    menuItems:[{id:'item-a',name:'Dal Fry',restaurant_id:itemRid}],
    activeMenuRestaurant:activeRid,menuEditScope:r=>allowed&&r===rid,
    menuRestaurantId:()=>rid,
    confirm: warning=>{calls.push(['confirm',warning]);return agree;},
    prompt: message=>{calls.push(['prompt',message]);return typed;},
    sb:{from:table=>{calls.push(['from',table]);return {delete:()=>{calls.push(['delete']);return query}}}},
    fetchMenuData:async()=>{calls.push(['refresh'])},
    alert:msg=>notices.push(msg),
  };
  vm.createContext(sandbox);
  vm.runInContext(match[0]+';this.submit=deleteMenuItem;',sandbox);
  await sandbox.submit('item-a');
  return {calls,notices};
}
test('pause is recommended and declining confirmation performs no write', async()=>{
  const result=await run({agree:false});
  assert.ok(result.calls[0][1].includes('Pause'));
  assert.ok(result.calls[0][1].includes('hamesha'));
  assert.equal(result.calls.some(c=>c[0]==='from'),false);
});
test('name mismatch or cancellation does not delete',async()=>{
  for(const typed of ['Daal Fry','dal fry','',null]){
    const result=await run({typed});
    assert.equal(result.calls.some(c=>c[0]==='from'),false);
  }
});
test('exact name still scopes operation to restaurant and confirms affected row',async()=>{
  const result=await run();
  assert.deepEqual(result.calls.filter(x=>x[0]==='eq'),[['eq','id','item-a'],['eq','restaurant_id','hotel-1']]);
  assert.ok(result.calls.find(x=>x[0]==='select'&&x[1]==='id'));
  assert.equal(result.calls.at(-1)[0],'refresh');
  assert.equal(result.notices.length,0);
});
test('RLS-denied or zero-row delete is not displayed as success',async()=>{
  const denied=await run({data:[]});
  assert.ok(denied.notices[0].includes('Delete confirm nahi hua'));
  assert.equal(denied.calls.at(-1)[0],'refresh');
  const failure=await run({data:null,error:{message:'blocked'}});
  assert.ok(failure.notices[0].includes('blocked'));
  assert.equal(failure.calls.some(c=>c[0]==='refresh'),false);
});

test('R14 menu delete fails closed for another tenant, stale workspace or missing permission',async()=>{
 for(const options of [{itemRid:'hotel-2'},{activeRid:'hotel-2'},{allowed:false}]){
  const result=await run(options);assert.equal(result.calls.length,0);
 }
});
