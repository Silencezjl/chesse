import React from 'react';
declare global {interface Window {PlayerNames?: {text:(value:unknown)=>string;random:(previous?:string)=>string}}}
export default function NameText({value}: {value?:string|null}) {
  const text = window.PlayerNames?.text(value) ?? String(value ?? '');
  return <>{text.split(/(#\d{2}(?!\d))/g).map((part,i)=>/^#\d{2}$/.test(part)?<span key={i} className="name-tag">{part}</span>:part)}</>;
}
