// Kenney Animal Pack Redux (CC0). Local fixed assets; no external avatar requests.
(() => {
  const ids = Array.from({length:30},(_,i)=>`animal-${String(i+1).padStart(2,'0')}`);
  const labels = ["小兔子", "熊猫", "小狗", "猫头鹰", "企鹅", "树懒", "小熊", "小鸡", "青蛙", "猴子", "小鸭", "小猪", "奶牛", "长颈鹿", "大象", "河马", "小马", "驼鹿", "水牛", "山羊", "大猩猩", "鳄鱼", "犀牛", "独角鲸", "海象", "鲸鱼", "斑马", "鹦鹉", "母鸡", "小蛇"];
  const legacy = ['🐭','🦊','🐼','🐸','🐱','🐶','🐰','🐻'];
  const normalize = value => {
    if(ids.includes(value)) return value;
    const old = typeof value === 'string' && /^avatar-0([1-8])$/.exec(value);
    return ids[old ? Number(old[1])-1 : Math.max(0,legacy.indexOf(value))];
  };
  const src = value => `/assets/avatars/animals-v1/${normalize(value)}.png`;
  const label = value => labels[ids.indexOf(normalize(value))];
  const html = value => `<img class="user-avatar" src="${src(value)}" alt="" width="32" height="32" decoding="async">`;
  globalThis.GameAvatars = Object.freeze({ids,normalize,src,label,html});
})();
