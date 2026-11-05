import React from 'react';
export default function NameInput({value, onChange, maxLength=12, ...props}) {
  const text = window.PlayerNames?.text(value) ?? String(value ?? '');
  const match = /^(.*)(#\d{2})$/.exec(text), base=match?match[1]:text, tag=match?match[2]:'';
  return <div className="nickname-editor"><input {...props} value={base} maxLength={tag?maxLength-3:maxLength} onChange={e=>onChange(e.target.value+tag)} /><span className="name-tag">{tag}</span></div>;
}
