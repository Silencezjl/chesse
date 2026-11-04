import React from 'react';
declare global {
  interface Window {
    GameAvatars?: {ids:string[];normalize:(value:unknown)=>string;src:(value:unknown)=>string;html:(value:unknown)=>string};
  }
}
export default function Avatar({value, size=32}: {value?:string;size?:number}) {
  return <img src={window.GameAvatars?.src(value) || '/assets/avatars/avatar-01.svg'} alt="" width={size} height={size} className="user-avatar" decoding="async" />;
}
