import React from 'react';
import {createRoot} from 'react-dom/client';
import {PlatformContext,GameContext} from '../../platform/context';
import RoomPage from './pages/RoomPage';
import {createGameStore,StoreContext} from './store';
import {useAudioUnlock} from './hooks/useAudioUnlock';
import css from './index.css?inline';
export function mount(context:GameContext,element:HTMLElement){
  context.root.querySelector('style')!.textContent+=css;
  const store=createGameStore();
  store.setState({playerId:context.playerId,roomId:context.roomId});
  function Game(){useAudioUnlock();return <RoomPage/>;}
  const root=createRoot(element);
  root.render(<PlatformContext.Provider value={context}><StoreContext.Provider value={store}><Game/></StoreContext.Provider></PlatformContext.Provider>);
  return ()=>{root.unmount();store.getState().reset();};
}
