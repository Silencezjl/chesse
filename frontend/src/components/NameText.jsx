import React from 'react';
export default function NameText({value}) {
  const text = window.PlayerNames?.text(value) ?? String(value ?? '');
  return <>{text}</>;
}
