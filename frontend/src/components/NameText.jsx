import React from 'react';
export default function NameText({value}) {
  const text = window.PlayerNames?.text(value) ?? String(value ?? '');
  return <>{text.split(/(#\d{2}(?!\d))/g).map((part,i)=>/^#\d{2}$/.test(part)?<span key={i} className="name-tag">{part}</span>:part)}</>;
}
