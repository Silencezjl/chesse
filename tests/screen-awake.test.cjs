const {test}=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const fs=require('node:fs');
const source=fs.readFileSync('web/platform/screen-awake.js','utf8').replace('export function createScreenAwake','function createScreenAwake');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function setup(secure=true){
  const dom=new JSDOM('<body></body>',{url:'https://example.test',runScripts:'outside-only'}),w=dom.window;
  let hidden=false,clock=0,serial=0;const requests=[],locks=[],timers=new Map();
  Object.defineProperty(w.document,'hidden',{get:()=>hidden});
  w.setTimeout=(fn,delay)=>{const id=++serial;timers.set(id,{fn,at:clock+delay});return id;};
  w.clearTimeout=id=>timers.delete(id);
  async function advance(ms){
    const end=clock+ms;
    while(true){const next=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];if(!next||next[1].at>end)break;
      clock=next[1].at;timers.delete(next[0]);next[1].fn();await tick();}
    clock=end;await tick();
  }
  function sentinel(){
    const s=new w.EventTarget();s.released=false;
    s.release=async()=>{s.released=true;s.dispatchEvent(new w.Event('release'));};locks.push(s);return s;
  }
  const nav={wakeLock:{request:async type=>{requests.push(type);return sentinel();}}};
  w.eval(source+';window.factory=createScreenAwake');
  const controller=w.factory({doc:w.document,nav,secure});
  return {w,dom,nav,locks,requests,timers,controller,sentinel,advance,
    hidden(value){hidden=value;w.document.dispatchEvent(new w.Event('visibilitychange'));},
    close(){controller.dispose();dom.window.close();}};
}
test('one native lock survives refreshes and checks, releases in background and restores in foreground',async()=>{
  const a=setup();try{
    a.controller.setActive(true);a.controller.setActive(true);await tick();await a.advance(20000);
    assert.deepEqual(a.requests,['screen']);assert.equal(a.timers.size,1);
    a.hidden(true);await tick();assert.ok(a.locks[0].released);assert.equal(a.timers.size,0);
    await a.advance(60000);assert.equal(a.requests.length,1);
    a.hidden(false);await tick();assert.equal(a.requests.length,2);
    a.controller.setActive(false);await a.advance(60000);assert.ok(a.locks[1].released);
    a.w.document.dispatchEvent(new a.w.Event('pointerdown'));await tick();assert.equal(a.requests.length,2);
    assert.equal(a.timers.size,0);
  }finally{a.close();}
});
test('late results from the previous session cannot replace or clear a new pending lock',async()=>{
  const a=setup();try{
    const pending=[];a.nav.wakeLock.request=()=>new Promise(resolve=>pending.push(resolve));
    a.controller.setActive(true);a.controller.setActive(false);a.controller.setActive(true);
    const stale=a.sentinel();pending[0](stale);await tick();assert.ok(stale.released);
    a.w.document.dispatchEvent(new a.w.Event('pointerdown'));assert.equal(pending.length,2);
    const current=a.sentinel();pending[1](current);await tick();assert.equal(a.controller.status,'active');
    a.controller.dispose();await tick();assert.ok(current.released);assert.equal(a.timers.size,0);
    a.controller.setActive(true);await tick();assert.equal(pending.length,2);
  }finally{a.close();}
});
test('unsupported contexts do not claim success or schedule polling',async()=>{
  const a=setup(false);try{
    a.controller.setActive(true);await a.advance(60000);
    assert.equal(a.controller.status,'unsupported');assert.equal(a.requests.length,0);assert.equal(a.timers.size,0);
    assert.equal(a.w.document.querySelector('video'),null);
  }finally{a.close();}
});
test('a visible system release recovers automatically without any user interaction',async()=>{
  const a=setup();try{
    a.controller.setActive(true);await tick();await a.locks[0].release();
    assert.equal(a.controller.status,'released');await a.advance(1000);
    assert.equal(a.controller.status,'active');assert.equal(a.requests.length,2);
    assert.equal(a.controller.diagnostics().interruptions,1);
  }finally{a.close();}
});
test('periodic checks detect an expired sentinel even without its release event',async()=>{
  const a=setup();try{
    a.controller.setActive(true);await tick();a.locks[0].released=true;await a.advance(5000);
    assert.equal(a.requests.length,2);assert.equal(a.controller.status,'active');
    assert.equal(a.controller.diagnostics().interruptions,1);assert.equal(a.timers.size,1);
  }finally{a.close();}
});
test('rejected native requests back off, recover without touching and stop retries on leaving',async()=>{
  const a=setup();try{
    let count=0;a.nav.wakeLock.request=async()=>{count++;throw new a.w.DOMException('Power saving','NotAllowedError');};
    a.controller.setActive(true);await tick();assert.equal(a.controller.status,'denied');
    assert.equal(a.controller.diagnostics().lastError.name,'NotAllowedError');
    await a.advance(1000);assert.equal(count,2);await a.advance(2000);assert.equal(count,3);
    await a.advance(4000+8000+16000);assert.equal(count,6);
    await a.advance(29999);assert.equal(count,6);await a.advance(1);assert.equal(count,7);
    a.nav.wakeLock.request=async()=>a.sentinel();await a.advance(30000);
    assert.equal(a.controller.status,'active');assert.equal(a.controller.diagnostics().lastError,null);
    a.controller.setActive(false);await a.advance(60000);assert.equal(count,7);assert.equal(a.timers.size,0);
  }finally{a.close();}
});
test('backgrounding cancels recovery, pagehide stays paused until pageshow and dispose removes listeners',async()=>{
  const a=setup();try{
    a.controller.setActive(true);await tick();await a.locks[0].release();a.hidden(true);
    await a.advance(60000);assert.equal(a.requests.length,1);
    a.hidden(false);await tick();assert.equal(a.requests.length,2);
    a.w.dispatchEvent(new a.w.Event('pagehide'));
    a.w.dispatchEvent(new a.w.Event('focus'));a.w.document.dispatchEvent(new a.w.Event('pointerdown'));
    await a.advance(10000);assert.equal(a.requests.length,2);
    a.w.dispatchEvent(new a.w.Event('pageshow'));await tick();assert.equal(a.requests.length,3);
    a.controller.dispose();a.w.dispatchEvent(new a.w.Event('pageshow'));a.w.dispatchEvent(new a.w.Event('focus'));
    await a.advance(10000);assert.equal(a.requests.length,3);assert.equal(a.timers.size,0);
  }finally{a.close();}
});
test('manual retry renews a held lock, immediate expired results never report active and diagnostics stay bounded',async()=>{
  const a=setup();try{
    a.controller.setActive(true);await tick();a.controller.retry();await tick();
    assert.ok(a.locks[0].released);assert.equal(a.requests.length,2);assert.equal(a.controller.status,'active');
    a.nav.wakeLock.request=async()=>{const s=a.sentinel();s.released=true;return s;};
    a.controller.retry();await tick();assert.equal(a.controller.status,'released');
    for(let i=0;i<30;i++){a.hidden(true);a.hidden(false);await tick();}
    assert.ok(a.controller.diagnostics().events.length<=60);
    a.hidden(true);assert.equal(a.controller.status,'paused');assert.equal(a.timers.size,0);
  }finally{a.close();}
});
