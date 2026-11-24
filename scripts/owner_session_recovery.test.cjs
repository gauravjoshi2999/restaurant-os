'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {createReader, watchBoot} = require('../assets/owner-session-recovery.js');
const html = fs.readFileSync('index.html', 'utf8');
const start = html.indexOf('(async()=>{\n let session=null,restoreError=null;');
const boot = html.slice(start, html.indexOf('</script>', start));
const flush = async () => { for (let i=0; i<20; i++) await Promise.resolve(); };
function clock() {
  const jobs = new Map(); let next = 0;
  return {
    setTimeout(fn, delay) { const id=++next; jobs.set(id, {fn,delay}); return id; },
    clearTimeout(id) { jobs.delete(id); },
    fire() { const saved=[...jobs.values()]; jobs.clear(); saved.forEach(j=>j.fn()); },
    get size() { return jobs.size; }
  };
}
function fixture(getSession) {
  const timer=clock(), errors=[], activations=[];
  const retry={hidden:true}; let locked=true, modes=0;
  const read=createReader(getSession,timer);
  const context={
    readSavedOwnerSession:read, location:{hash:'',search:''},
    setTimeout:timer.setTimeout, URLSearchParams,
    document:{body:{classList:{remove:()=>{locked=false;}}},getElementById:()=>retry},
    showAuthError(message){errors.push(message);locked=false;},
    setAuthMode(){modes++;}, activateSession:async user=>activations.push(user)
  };
  const completion=vm.runInNewContext(boot,context);
  return {timer,errors,activations,retry,read,completion,get locked(){return locked;},get modes(){return modes;}};
}

test('one SDK read serves simultaneous observers and releases every deadline',async()=>{
  const c=clock(); let calls=0,finish;
  const read=createReader(()=>{calls++;return new Promise(resolve=>{finish=resolve;});},c);
  const a=read(),b=read();await flush();assert.equal(calls,1);
  const result={data:{session:{user:{id:'synthetic-owner'}}}};
  finish(result);assert.equal(await a,result);assert.equal(await b,result);assert.equal(c.size,0);
});

test('a frozen session reveals bounded recovery; a late response cannot activate it',async()=>{
  let finish,calls=0;
  const f=fixture(()=>{calls++;return new Promise(resolve=>{finish=resolve;});});
  await flush();assert.equal(calls,1);assert.equal(f.locked,true);
  f.timer.fire();await f.completion;
  assert.equal(f.errors.length,1);assert.equal(f.retry.hidden,false);assert.equal(f.locked,false);
  assert.equal(f.activations.length,0);
  const again=f.read();const observed=assert.rejects(again,{code:'BITE_SESSION_TIMEOUT'});
  await flush();assert.equal(calls,1,'reconnect must not queue a second hung SDK read');
  f.timer.fire();await observed;
  finish({data:{session:{user:{id:'late-synthetic-owner'}}}});await flush();
  assert.equal(f.activations.length,0,'timed-out observer must never open a late workspace');
});

test('a fresh explicit retry can restore saved login after the old operation settles',async()=>{
  const c=clock();let finish,calls=0;
  const read=createReader(()=>{calls++;return calls===1?new Promise(resolve=>{finish=resolve;}):{data:{session:{user:{id:'synthetic-owner'}}}};},c);
  const first=read();const observed=assert.rejects(first,{code:'BITE_SESSION_TIMEOUT'});
  await flush();c.fire();await observed;finish({data:{session:null}});await flush();
  assert.equal((await read()).data.session.user.id,'synthetic-owner');assert.equal(calls,2);assert.equal(c.size,0);
});

test('signed-out boot exposes login; a saved user follows the existing activation path',async()=>{
  const guest=fixture(()=>({data:{session:null}}));await guest.completion;
  assert.equal(guest.locked,false);assert.equal(guest.modes,1);assert.equal(guest.activations.length,0);
  const user={id:'synthetic-user',app_metadata:{}};
  const owner=fixture(()=>({data:{session:{user}}}));await owner.completion;
  assert.equal(owner.activations[0],user);assert.equal(owner.errors.length,0);
});

test('repeated SDK errors retain the existing three-attempt recovery without clearing login',async()=>{
  let calls=0;const f=fixture(()=>{calls++;throw new Error('offline');});
  await flush();f.timer.fire();await flush();f.timer.fire();await f.completion;
  assert.equal(calls,3);assert.equal(f.retry.hidden,false);assert.equal(f.activations.length,0);
  assert.equal(f.timer.size,0);
});

test('watchdog offers reload before dependencies load and never unlocks private views',()=>{
  const c=clock(),recovery={hidden:true},loading=[{hidden:false},{hidden:false}];let locked=true;
  const doc={body:{classList:{contains:()=>locked}},getElementById:()=>recovery,querySelectorAll:()=>loading};
  watchBoot(doc,c);c.fire();assert.equal(recovery.hidden,false);assert.equal(locked,true);
  assert.ok(loading.every(el=>el.hidden));
  recovery.hidden=true;loading.forEach(el=>el.hidden=false);locked=false;watchBoot(doc,c);c.fire();
  assert.equal(recovery.hidden,true);assert.ok(loading.every(el=>!el.hidden));
});

test('recovery is installed before CDN dependencies; credentials/storage and role checks are untouched',()=>{
  assert.ok(html.indexOf('assets/owner-session-recovery.js?')<html.indexOf('https://cdn.jsdelivr.net/npm/@supabase'));
  assert.match(html,/body\.bite-session-check #mainApp\{display:none!important\}/);
  const retry=html.slice(html.indexOf('async function retrySavedOwnerSession'),html.indexOf("window.addEventListener('online'"));
  assert.match(retry,/if\(button.disabled\)return/);assert.match(retry,/await readSavedOwnerSession\(\)/);
  const asset=fs.readFileSync('assets/owner-session-recovery.js','utf8');
  assert.doesNotMatch(asset,/signOut|localStorage|sessionStorage|service_role|activateSession/);
});
