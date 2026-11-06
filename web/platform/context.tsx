import {createContext,useContext} from 'react';
export interface GameContext {roomId:string;playerId:string;sessionId:string;name:string;avatar:string;root:ShadowRoot;onConnection:(connected:boolean)=>void;onReturn:()=>void;signal:AbortSignal;}
export const PlatformContext=createContext<GameContext>(null!);
export const usePlatform=()=>useContext(PlatformContext);
