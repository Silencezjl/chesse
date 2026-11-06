import type {GameContext} from './context';
import commonCss from '../../lobby-web/mobile-tokens.css?inline';

// Register one lazy module per game. Identity, theme and lifecycle belong to the host.
const games = {
  holdem:()=>import('../games/holdem/entry'),
  cheese:()=>import('../games/cheese/entry'),
  bluff:()=>import('../games/bluff-entry'),
};
export function createGameHost(container:HTMLElement){
  let version=0,session='',dispose:(()=>void)|undefined,controller:AbortController|undefined;
  const shadow=container.attachShadow({mode:'open'});
  const resize=new ResizeObserver(()=>container.style.setProperty('--game-height',`${container.clientHeight}px`));
  resize.observe(container);
  return {
    async mount(gameId:keyof typeof games, context:Omit<GameContext,'root'|'signal'>){
      if(session===context.sessionId)return;
      this.clear();session=context.sessionId;const current=version;
      controller=new AbortController();
      const style=document.createElement('style');style.textContent=commonCss+'\n:host{display:block;height:100%;min-height:0;color:var(--mobile-ink);background:var(--mobile-background);position:relative;'+(gameId==='holdem'?'':'transform:translateZ(0);')+'}.game-page{height:100%;overflow:auto;overscroll-behavior:contain}';
      const element=document.createElement('main');element.className='game-page';shadow.replaceChildren(style,element);
      try{
        const signal=controller.signal;
        const module=await games[gameId]();
        if(current!==version||signal.aborted)return;
        const cleanup=module.mount({...context,root:shadow,signal},element);
        if(current!==version){cleanup();return;}dispose=cleanup;
      }catch(error){if(current!==version)return;element.textContent='游戏加载失败，请刷新重试。';context.onConnection(false);console.error(error);}
    },
    conceal(){controller?.signal.dispatchEvent(new Event('conceal'));},
    clear(){version++;session='';controller?.abort();dispose?.();dispose=undefined;shadow.replaceChildren();},
  };
}
