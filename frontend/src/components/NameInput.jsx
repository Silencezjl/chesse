import React from 'react';
export default function NameInput({value, onChange, maxLength=12, ...props}) {
  const text = window.PlayerNames?.text(value) ?? String(value ?? '');
  return <div className="nickname-editor"><input {...props} value={text} maxLength={maxLength} onChange={e=>onChange(e.target.value)} /></div>;
}
