// Local DiceBear Thumbs artwork (CC0). Only fixed asset IDs reach image URLs.
(() => {
  const ids = Array.from({length:8},(_,i)=>`avatar-${String(i+1).padStart(2,'0')}`);
  const legacy = ['🐭','🦊','🐼','🐸','🐱','🐶','🐰','🐻'];
  const normalize = value => ids.includes(value) ? value : ids[Math.max(0,legacy.indexOf(value))];
  const src = value => `/assets/avatars/${normalize(value)}.svg`;
  const html = value => `<img class="user-avatar" src="${src(value)}" alt="" width="32" height="32" decoding="async">`;
  globalThis.GameAvatars = Object.freeze({ids,normalize,src,html});
})();
