// Foreground screen retention. This does not keep background network connections alive.
export function createScreenAwake({doc=document,nav=navigator,secure=globalThis.isSecureContext}={}) {
  let active=false, generation=0, lock=null, video=null, pendingGeneration=null;
  const wanted=()=>active&&!doc.hidden;
  const native=()=>secure&&typeof nav.wakeLock?.request==='function';
  function release(){
    generation++;
    const previous=lock;lock=null;
    if(previous)Promise.resolve(previous.release()).catch(()=>{});
    if(video){const previousVideo=video;video=null;previousVideo.pause();previousVideo.removeAttribute('src');previousVideo.load();previousVideo.remove();}
  }
  async function playVideo(version){
    if(!wanted()||version!==generation)return;
    if(!video){
      video=doc.createElement('video');
      video.src='/awake/loop.mp4';video.muted=true;video.loop=true;video.playsInline=true;
      video.setAttribute('playsinline','');video.setAttribute('aria-hidden','true');video.tabIndex=-1;
      video.dataset.screenAwake='';
      Object.assign(video.style,{position:'fixed',width:'1px',height:'1px',bottom:'0',left:'0',opacity:'0.01',pointerEvents:'none'});
      doc.body.appendChild(video);
    }
    const target=video;
    try{await target.play();if(!wanted()||version!==generation)target.pause();}catch{/* Retry on the next interaction if autoplay is blocked. */}
  }
  async function acquire(gesture=false){
    if(!wanted()||lock||pendingGeneration===generation)return;
    const version=generation;
    if(!native()){
      // Muted autoplay may work immediately; interactions retry when it is blocked.
      await playVideo(version);
      return;
    }
    pendingGeneration=version;
    try{
      const sentinel=await nav.wakeLock.request('screen');
      if(!wanted()||version!==generation){await sentinel.release();return;}
      lock=sentinel;
      sentinel.addEventListener('release',()=>{if(lock===sentinel)lock=null;},{once:true});
    }catch{if(gesture)await playVideo(version);}
    finally{if(pendingGeneration===version)pendingGeneration=null;}
  }
  const interaction=()=>{if(!video||video.paused)void acquire(true);};
  const visibility=()=>{if(doc.hidden)release();else void acquire();};
  const pageHide=()=>release();
  doc.addEventListener('visibilitychange',visibility);
  doc.addEventListener('pointerdown',interaction,{passive:true,capture:true});
  doc.addEventListener('keydown',interaction,{capture:true});
  globalThis.addEventListener('pagehide',pageHide);
  globalThis.addEventListener('pageshow',visibility);
  return {
    setActive(value){if(active===value)return;active=value;if(active)void acquire(Boolean(nav.userActivation?.isActive));else release();},
    dispose(){active=false;release();doc.removeEventListener('visibilitychange',visibility);doc.removeEventListener('pointerdown',interaction,true);doc.removeEventListener('keydown',interaction,true);globalThis.removeEventListener('pagehide',pageHide);globalThis.removeEventListener('pageshow',visibility);},
  };
}
