const {test}=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const fs=require('node:fs');
const html=fs.readFileSync('web/public/awake-check.html','utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function setup(){
  let hidden=false,clock=100000,serial=0;const requests=[],locks=[],timers=new Map();
  let nav;
  const dom=new JSDOM(html,{url:'https://example.test/awake-check.html',runScripts:'dangerously',beforeParse(w){
    Object.defineProperty(w,'isSecureContext',{value:true});Object.defineProperty(w.document,'hidden',{get:()=>hidden});
    w.Date.now=()=>clock;
    w.setInterval=(fn,delay)=>{const id=++serial;timers.set(id,{fn,delay,next:clock+delay});return id;};
    w.clearInterval=id=>timers.delete(id);
    w.fetch=()=>{throw Error('control page must not fetch lobby data');};
    nav=w.navigator;Object.defineProperty(nav,'wakeLock',{value:{request:async type=>{
      requests.push(type);const lock=new w.EventTarget();lock.released=false;
      lock.release=async()=>{lock.released=true;lock.dispatchEvent(new w.Event('release'));};locks.push(lock);return lock;
    }}});
    Object.defineProperty(nav,'userAgentData',{value:{getHighEntropyValues:async()=>({model:'test-model',platformVersion:'17.0.0',fullVersionList:[{brand:'Chrome',version:'138.0.7204.168'}]})}});
  }});
  const w=dom.window;
  return {dom,w,nav,requests,locks,timers,
    click:async id=>{w.document.getElementById(id).click();await tick();},
    report:()=>JSON.parse(w.document.getElementById('report').value),
    hidden(value){hidden=value;w.document.dispatchEvent(new w.Event('visibilitychange'));},
    async advance(ms){const end=clock+ms;while(true){const next=[...timers.values()].sort((a,b)=>a.next-b.next)[0];if(!next||next.next>end)break;clock=next.next;next.next+=next.delay;next.fn();await tick();}clock=end;await tick();},
    close(){w.dispatchEvent(new w.Event('pagehide'));dom.window.close();}};
}
test('independent page uses one raw request, has no app imports and does not claim hardware verification',async()=>{
  const a=setup();try{
    assert.equal(a.w.document.querySelector('script[src]'),null);assert.equal(a.w.document.querySelector('iframe'),null);
    await a.click('start');assert.deepEqual(a.requests,['screen']);await a.advance(60000);
    assert.equal(a.requests.length,1);assert.equal(a.report().runs[0].result,'visible-for-60s');
    assert.equal(a.report().browserDetails.model,'test-model');assert.equal(a.locks[0].released,false);
    assert.match(a.w.document.getElementById('status').textContent,/请确认屏幕/);
    await a.click('stop');assert.ok(a.locks[0].released);assert.equal(a.timers.size,0);
  }finally{a.close();}
});
test('30 second hiding or release is recorded as interruption and never silently restored or marked passed',async()=>{
  const a=setup();try{
    await a.click('start');await a.advance(30000);a.hidden(true);await a.locks[0].release();a.hidden(false);
    await a.advance(90000);const report=a.report();
    assert.equal(report.runs[0].result,'interrupted');assert.equal(report.runs[0].durationMs,30000);
    assert.equal(a.requests.length,1);assert.equal(a.timers.size,0);
    assert.ok(report.events.some(e=>e.event==='hidden'));assert.ok(report.events.some(e=>e.event==='native-release'));
  }finally{a.close();}
});
test('native rejection is reported and a late native result after navigation is released',async()=>{
  const a=setup();try{
    a.nav.wakeLock.request=async()=>{throw new a.w.DOMException('Denied','NotAllowedError');};
    await a.click('start');assert.ok(a.report().events.some(e=>e.event==='request-error'&&e.detail.name==='NotAllowedError'));
    let resolve;a.nav.wakeLock.request=()=>new Promise(r=>resolve=r);await a.click('start');
    a.w.dispatchEvent(new a.w.Event('pagehide'));
    let released=false;resolve({release:async()=>{released=true;}});await tick();
    assert.equal(released,true);assert.equal(a.timers.size,0);
  }finally{a.close();}
});
test('copy produces a fresh local report and manual restart creates separate runs',async()=>{
  const a=setup();try{
    let copied;Object.defineProperty(a.nav,'clipboard',{value:{writeText:async text=>{copied=JSON.parse(text);}}});
    await a.click('start');await a.advance(20000);await a.click('start');
    assert.ok(a.locks[0].released);assert.equal(a.requests.length,2);await a.click('copy');
    assert.equal(copied.runs[0].result,'restarted');assert.equal(copied.runs[1].result,'running');
    assert.equal(copied.kind,'native-wake-lock-control');assert.equal(copied.released,false);
    assert.equal(copied.runs[1].durationMs,undefined);
  }finally{a.close();}
});
