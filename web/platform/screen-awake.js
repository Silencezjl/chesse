// Only a granted native wake lock is reported as active.
export function createScreenAwake({doc=document,nav=navigator,secure=globalThis.isSecureContext,onChange=()=>{}}={}) {
  let active=false,generation=0,lock=null,pendingGeneration=null,status='inactive';
  const wanted=()=>active&&!doc.hidden;
  const update=value=>{if(status!==value){status=value;onChange(value);}};
  function release(){
    generation++;
    const previous=lock;lock=null;
    if(previous)Promise.resolve(previous.release()).catch(()=>{});
    update(active?'paused':'inactive');
  }
  async function acquire(){
    if(!wanted()||lock||pendingGeneration===generation)return;
    if(!secure||typeof nav.wakeLock?.request!=='function'){update('unsupported');return;}
    const version=generation;pendingGeneration=version;update('requesting');
    try{
      const sentinel=await nav.wakeLock.request('screen');
      if(!wanted()||version!==generation){await sentinel.release();return;}
      lock=sentinel;update('active');
      sentinel.addEventListener('release',()=>{if(lock===sentinel){lock=null;update(wanted()?'released':'paused');}},{once:true});
    }catch{if(wanted()&&version===generation)update('denied');}
    finally{if(pendingGeneration===version)pendingGeneration=null;}
  }
  const interaction=()=>void acquire();
  const visibility=()=>{if(doc.hidden)release();else void acquire();};
  const pageHide=()=>release();
  doc.addEventListener('visibilitychange',visibility);
  doc.addEventListener('pointerdown',interaction,{passive:true,capture:true});
  doc.addEventListener('keydown',interaction,{capture:true});
  globalThis.addEventListener('pagehide',pageHide);
  globalThis.addEventListener('pageshow',visibility);
  return {
    get status(){return status;},
    setActive(value){if(active===value)return;active=value;if(active)void acquire();else release();},
    retry(){void acquire();},
    dispose(){active=false;release();doc.removeEventListener('visibilitychange',visibility);doc.removeEventListener('pointerdown',interaction,true);doc.removeEventListener('keydown',interaction,true);globalThis.removeEventListener('pagehide',pageHide);globalThis.removeEventListener('pageshow',visibility);},
  };
}
