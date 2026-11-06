import React from 'react';
import {createRoot} from 'react-dom/client';
import {PlatformContext,GameContext} from '../../platform/context';
import App from './App';
import css from './index.css?inline';
export function mount(context:GameContext,element:HTMLElement){
  context.root.querySelector('style')!.textContent+=css;
  const root=createRoot(element);
  root.render(<PlatformContext.Provider value={context}><App/></PlatformContext.Provider>);
  return ()=>root.unmount();
}
