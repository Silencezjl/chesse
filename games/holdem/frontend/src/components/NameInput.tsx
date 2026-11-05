import React from 'react';
type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value'|'onChange'> & {value:string;onChange:(value:string)=>void};
export default function NameInput({value, onChange, maxLength=12, ...props}: Props) {
  const text = window.PlayerNames?.text(value) ?? String(value ?? '');
  return <div className="nickname-editor"><input {...props} value={text} maxLength={maxLength} onChange={e=>onChange(e.target.value)} /></div>;
}
