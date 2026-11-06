// Keep one native screen lock while a game is active and the page is visible.
export function createScreenAwake({doc=document,nav=navigator,secure=globalThis.isSecureContext,onChange=()=>{}}={}) {
  const win=doc.defaultView || globalThis;
  let active=false,suspended=false,disposed=false,generation=0,lock=null,pending=null,status='inactive';
  const wanted=()=>active&&!doc.hidden&&!suspended&&!disposed;
  const update=value=>{if(status!==value){status=value;onChange(value);}};
  function release(){
    generation++;
    const previous=lock;lock=null;
    if(previous)Promise.resolve(previous.release()).catch(()=>{});
    update(active?'paused':'inactive');
  }
  async function acquire(){
    if(!wanted()||(lock&&!lock.released)||pending===generation)return;
    lock=null;
    if(!secure||typeof nav.wakeLock?.request!=='function'){update('unsupported');return;}
    const version=generation;pending=version;update('requesting');
    try{
      const sentinel=await nav.wakeLock.request('screen');
      if(!wanted()||version!==generation){await sentinel.release();return;}
      if(sentinel.released){update('released');return;}
      lock=sentinel;update('active');
      sentinel.addEventListener('release',()=>{
        if(lock!==sentinel)return;
        lock=null;update(wanted()?'released':active?'paused':'inactive');
      },{once:true});
    }catch{if(wanted()&&version===generation)update('denied');}
    finally{if(pending===version)pending=null;}
  }
  const interaction=()=>void acquire();
  const visibility=()=>{if(doc.hidden)release();else void acquire();};
  const pageHide=()=>{suspended=true;release();};
  const pageShow=()=>{suspended=false;visibility();};
  doc.addEventListener('visibilitychange',visibility);
  doc.addEventListener('pointerdown',interaction,{passive:true,capture:true});
  doc.addEventListener('keydown',interaction,{capture:true});
  win.addEventListener('pagehide',pageHide);
  win.addEventListener('pageshow',pageShow);
  return {
    get status(){return status;},
    setActive(value){
      if(disposed||active===value)return;
      active=value;if(wanted())void acquire();else release();
    },
    dispose(){
      if(disposed)return;
      disposed=true;active=false;release();
      doc.removeEventListener('visibilitychange',visibility);
      doc.removeEventListener('pointerdown',interaction,true);doc.removeEventListener('keydown',interaction,true);
      win.removeEventListener('pagehide',pageHide);win.removeEventListener('pageshow',pageShow);
    },
  };
}
