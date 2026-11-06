import React from 'react';
export default function Avatar({value, size=32}) {
  return <img src={window.GameAvatars?.src(value) || '/assets/avatars/animals-v1/animal-01.png'} alt="" width={size} height={size} className="user-avatar" decoding="async" />;
}
