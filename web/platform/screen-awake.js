// A sentinel confirms the browser accepted the request; the OS can still override it.
export function createScreenAwake({doc=document,nav=navigator,secure=globalThis.isSecureContext,onChange=()=>{}}={}) {
  const win=doc.defaultView || globalThis;
  let active=false,suspended=false,disposed=false,generation=0,lock=null,pendingGeneration=null,status='inactive';
  let timer=null,failures=0,interruptions=0,heldSince=null,lastCheck=null,lastInteraction=null,lastError=null;
  const events=[];
  const wanted=()=>!disposed&&active&&!doc.hidden&&!suspended;
  const record=(event,detail)=>{
    events.push({at:new Date().toISOString(),event,visible:!doc.hidden,...(detail?{detail}:{})});
    if(events.length>60)events.shift();
  };
  const update=value=>{if(status!==value){status=value;record(value);onChange(value);}};
  const clearTimer=()=>{if(timer!==null)win.clearTimeout(timer);timer=null;};
  const schedule=delay=>{
    clearTimer();
    if(wanted())timer=win.setTimeout(()=>{timer=null;void acquire();},delay);
  };
  const backoff=()=>Math.min(1000*2**Math.min(failures++,5),30000);
  function release(reason){
    clearTimer();generation++;
    const previous=lock;lock=null;heldSince=null;
    if(previous){record('release-request',reason);Promise.resolve(previous.release()).catch(()=>{});}
    update(active?'paused':'inactive');
  }
  function interrupted(sentinel){
    if(lock!==sentinel)return;
    lock=null;heldSince=null;interruptions++;record('system-release');
    update(wanted()?'released':active?'paused':'inactive');
    schedule(backoff());
  }
  async function acquire(){
    if(!wanted())return;
    lastCheck=Date.now();
    // Recheck the sentinel itself: a delayed/missed release event must not leave a stale "active" label.
    if(lock?.released)interrupted(lock);
    if(lock){if(Date.now()-heldSince>=5000)failures=0;schedule(5000);return;}
    if(pendingGeneration===generation)return;
    clearTimer();
    if(!secure||typeof nav.wakeLock?.request!=='function'){update('unsupported');return;}
    const version=generation;pendingGeneration=version;update('requesting');
    try{
      const sentinel=await nav.wakeLock.request('screen');
      if(!wanted()||version!==generation){await sentinel.release();return;}
      lock=sentinel;
      sentinel.addEventListener('release',()=>interrupted(sentinel),{once:true});
      if(sentinel.released){interrupted(sentinel);return;}
      heldSince=Date.now();lastError=null;update('active');schedule(5000);
    }catch(error){
      if(wanted()&&version===generation){
        lastError={name:String(error?.name || 'Error'),message:String(error?.message || error).slice(0,240)};
        record('request-error',lastError);update('denied');schedule(backoff());
      }
    }finally{if(pendingGeneration===version)pendingGeneration=null;}
  }
  const interaction=()=>{lastInteraction=Date.now();void acquire();};
  const visibility=()=>{record(doc.hidden?'hidden':'visible',{idleMs:lastInteraction===null?null:Date.now()-lastInteraction});if(doc.hidden)release('hidden');else{failures=0;void acquire();}};
  const pageHide=()=>{suspended=true;record('pagehide');release('pagehide');};
  const pageShow=()=>{suspended=false;record('pageshow');visibility();};
  const focus=()=>{if(wanted()){record('focus');void acquire();}};
  const fullscreen=()=>{if(wanted()){record('fullscreen');void acquire();}};
  doc.addEventListener('visibilitychange',visibility);
  doc.addEventListener('fullscreenchange',fullscreen);
  doc.addEventListener('pointerdown',interaction,{passive:true,capture:true});
  doc.addEventListener('keydown',interaction,{capture:true});
  win.addEventListener('pagehide',pageHide);
  win.addEventListener('pageshow',pageShow);
  win.addEventListener('focus',focus);
  return {
    get status(){return status;},
    diagnostics(){return {version:2,status,active,visible:!doc.hidden,suspended,secure,
      supported:typeof nav.wakeLock?.request==='function',released:lock?.released ?? null,
      heldSince,lastCheck,lastInteraction,lastError,interruptions,events:events.map(event=>({...event}))};},
    setActive(value){
      if(disposed||active===value)return;
      active=value;failures=0;record(value?'session-start':'session-end');
      if(active){if(wanted())void acquire();else update('paused');}else release('session-end');
    },
    retry(){if(wanted()){failures=0;release('manual-retry');void acquire();}},
    dispose(){
      if(disposed)return;
      disposed=true;active=false;release('dispose');
      doc.removeEventListener('visibilitychange',visibility);doc.removeEventListener('fullscreenchange',fullscreen);
      doc.removeEventListener('pointerdown',interaction,true);doc.removeEventListener('keydown',interaction,true);
      win.removeEventListener('pagehide',pageHide);win.removeEventListener('pageshow',pageShow);win.removeEventListener('focus',focus);
    },
  };
}
