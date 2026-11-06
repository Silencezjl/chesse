import React from 'react';
declare global {interface Window {PlayerNames?: {text:(value:unknown)=>string;random:(previous?:string,occupied?:string[])=>string}}}
export default function NameText({value}: {value?:string|null}) {
  const text = window.PlayerNames?.text(value) ?? String(value ?? '');
  return <>{text}</>;
}
