const {test}=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const fs=require('node:fs');
const source=fs.readFileSync('web/platform/screen-awake.js','utf8').replace('export function createScreenAwake','function createScreenAwake');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function setup(secure=true){
  const dom=new JSDOM('<body></body>',{url:'https://example.test',runScripts:'outside-only'}),w=dom.window;
  let hidden=false;const requests=[],locks=[];
  Object.defineProperty(w.document,'hidden',{get:()=>hidden});
  function sentinel(){
    const s=new w.EventTarget();s.released=false;
    s.release=async()=>{s.released=true;s.dispatchEvent(new w.Event('release'));};locks.push(s);return s;
  }
  const nav={wakeLock:{request:async type=>{requests.push(type);return sentinel();}}};
  w.eval(source+';window.factory=createScreenAwake');
  const controller=w.factory({doc:w.document,nav,secure});
  return {w,nav,locks,requests,controller,sentinel,
    hidden(value){hidden=value;w.document.dispatchEvent(new w.Event('visibilitychange'));},
    close(){controller.dispose();dom.window.close();}};
}
test('one shared native lock survives renders and gestures, releases in background and restores in foreground',async()=>{
  const a=setup();try{
    a.controller.setActive(true);a.controller.setActive(true);await tick();
    a.w.document.dispatchEvent(new a.w.Event('pointerdown'));await tick();assert.deepEqual(a.requests,['screen']);
    a.hidden(true);await tick();assert.ok(a.locks[0].released);assert.equal(a.controller.status,'paused');
    a.hidden(false);await tick();assert.equal(a.requests.length,2);assert.equal(a.controller.status,'active');
    a.controller.setActive(false);await tick();assert.ok(a.locks[1].released);
    a.w.document.dispatchEvent(new a.w.Event('pointerdown'));await tick();assert.equal(a.requests.length,2);
    assert.equal(a.controller.status,'inactive');
  }finally{a.close();}
});
test('late results from a previous session cannot replace or clear a new pending lock',async()=>{
  const a=setup();try{
    const pending=[];a.nav.wakeLock.request=()=>new Promise(resolve=>pending.push(resolve));
    a.controller.setActive(true);a.controller.setActive(false);a.controller.setActive(true);
    const stale=a.sentinel();pending[0](stale);await tick();assert.ok(stale.released);
    a.w.document.dispatchEvent(new a.w.Event('pointerdown'));assert.equal(pending.length,2);
    const current=a.sentinel();pending[1](current);await tick();assert.equal(a.controller.status,'active');
    a.controller.dispose();await tick();assert.ok(current.released);
  }finally{a.close();}
});
test('HTTP and unsupported browsers never claim a native lock or use a video fallback',async()=>{
  for(const secure of [false,true]){
    const a=setup(secure);try{
      if(secure)delete a.nav.wakeLock;
      a.controller.setActive(true);await tick();assert.equal(a.controller.status,'unsupported');
      assert.equal(a.requests.length,0);assert.equal(a.w.document.querySelector('video'),null);
    }finally{a.close();}
  }
});
test('denied or system-released locks retry on a later touch or keyboard action',async()=>{
  const a=setup();try{
    a.nav.wakeLock.request=async()=>{throw new a.w.DOMException('Denied','NotAllowedError');};
    a.controller.setActive(true);await tick();assert.equal(a.controller.status,'denied');
    a.nav.wakeLock.request=async()=>a.sentinel();a.w.document.dispatchEvent(new a.w.Event('pointerdown'));await tick();
    assert.equal(a.controller.status,'active');await a.locks[0].release();assert.equal(a.controller.status,'released');
    a.w.document.dispatchEvent(new a.w.Event('keydown'));await tick();assert.equal(a.controller.status,'active');
    assert.equal(a.locks.length,2);
  }finally{a.close();}
});
test('pagehide stays paused until pageshow, and disposal prevents reacquisition including pending results',async()=>{
  const a=setup();try{
    a.controller.setActive(true);await tick();a.w.dispatchEvent(new a.w.Event('pagehide'));
    a.w.document.dispatchEvent(new a.w.Event('pointerdown'));await tick();assert.equal(a.requests.length,1);
    a.w.dispatchEvent(new a.w.Event('pageshow'));await tick();assert.equal(a.requests.length,2);
    a.hidden(true);let resolve;a.nav.wakeLock.request=()=>new Promise(r=>resolve=r);a.hidden(false);
    a.controller.dispose();const stale=a.sentinel();resolve(stale);await tick();assert.ok(stale.released);
    a.controller.setActive(true);a.w.dispatchEvent(new a.w.Event('pageshow'));a.w.document.dispatchEvent(new a.w.Event('pointerdown'));
    await tick();assert.equal(a.requests.length,2);assert.equal(a.controller.status,'inactive');
  }finally{a.close();}
});
test('already-expired native results are never active and a later gesture also checks stale sentinels',async()=>{
  const a=setup();try{
    a.nav.wakeLock.request=async()=>{const lock=a.sentinel();lock.released=true;return lock;};
    a.controller.setActive(true);await tick();assert.equal(a.controller.status,'released');
    a.nav.wakeLock.request=async()=>a.sentinel();a.w.document.dispatchEvent(new a.w.Event('pointerdown'));await tick();
    assert.equal(a.controller.status,'active');a.locks.at(-1).released=true;
    a.w.document.dispatchEvent(new a.w.Event('pointerdown'));await tick();assert.equal(a.locks.length,3);
    assert.equal(a.controller.status,'active');
  }finally{a.close();}
});
