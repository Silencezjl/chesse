import React from 'react';
export default function Avatar({value, size=32}) {
  return <img src={window.GameAvatars?.src(value) || '/assets/avatars/avatar-01.svg'} alt="" width={size} height={size} className="user-avatar" decoding="async" />;
}
