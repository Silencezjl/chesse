const root = document.querySelector('#app');
const deviceKey = 'lobby_player_id';
const playerId = localStorage.getItem(deviceKey) || (crypto.randomUUID ? crypto.randomUUID() : `p_${Date.now()}_${Math.random().toString(36).slice(2)}`);
localStorage.setItem(deviceKey, playerId);
let name = localStorage.getItem('lobby_name') || '';
let avatar = localStorage.getItem('lobby_avatar') || '🐭';
let room = null, socket = null, rooms = [], error = '', selected = new Set(), gameView = true, loadedGame = '', poll = null;
const esc = (x) => String(x ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(path, data) {
  const res = await fetch(`/lobby${path}`, data === undefined ? {} : {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(data)});
  const out = await res.json(); if (!res.ok) throw Error(out.detail || '操作失败'); return out;
}
const profile = () => ({player_id: playerId, name, avatar});
function showError(e) { error = e.message || String(e); render(); }
async function refreshRooms() { try { rooms = await api('/rooms'); if (!room) render(); } catch(e) { showError(e); } }
function closeSocket(){ if(socket){ const s=socket; socket=null; s.onclose=null; s.close(); } }
function connect(){
  closeSocket(); if(!room) return;
  const id=room.id; socket = new WebSocket(`${location.protocol==='https:'?'wss:':'ws:'}//${location.host}/lobby/rooms/${encodeURIComponent(id)}/ws/${encodeURIComponent(playerId)}`);
  socket.onmessage = e => { const m=JSON.parse(e.data); if(m.type==='room_state') updateRoom(m.data); };
  socket.onclose = () => { if(room?.id===id) setTimeout(connect,1500); };
}
function updateRoom(next){
  if(!next.members[playerId]) { room=null; closeSocket(); localStorage.removeItem('lobby_room_id'); refreshRooms(); render(); return; }
  if(room && JSON.stringify(room) === JSON.stringify(next)) return;
  const changed = !room || room.game_id!==next.game_id || room.session_id!==next.session_id;
  room=next;
  if(changed){ gameView=true; loadedGame=''; }
  // Keep a running game iframe mounted while presence/phase updates arrive.
  if (!changed && gameView && room.game_id && document.querySelector('iframe')) { updateControls(); return; }
  render();
}
function updateControls(){ const el=document.querySelector('#switch-note'); if(el) el.textContent=room.can_switch?'本局已结束，房主可切换游戏':'游戏进行中，结束后可切换'; const switcher=document.querySelector('#switch-btn'); if(switcher) switcher.disabled=!room.can_switch; }
async function loadRoom(id){ room=await api(`/rooms/${encodeURIComponent(id)}?player_id=${encodeURIComponent(playerId)}`); localStorage.setItem('lobby_room_id',id); connect(); render(); }
function lobbyView(){ return `<div class="grid"><section class="card"><div class="stack"><h2>你的资料</h2><p class="muted">同一设备在所有游戏中使用这份资料。</p></div><label>昵称<input id="name" maxlength="12" value="${esc(name)}" placeholder="输入昵称"></label><label>头像<input id="avatar" maxlength="16" value="${esc(avatar)}"></label><button id="create">创建房间</button></section><section class="card"><div class="row"><h2>加入房间</h2><button class="secondary" id="refresh">刷新</button></div><div class="row"><input id="join-code" maxlength="6" placeholder="输入房间号"><button id="join-code-btn">加入</button></div><div class="stack">${rooms.length ? rooms.map(r=>`<div class="row"><span>${esc(r.id)} · ${esc(r.members[r.owner_id]?.name || '房间')} · ${Object.keys(r.members).length}/12</span><button class="secondary join" data-id="${esc(r.id)}">加入</button></div>`).join('') : '<p class="muted">暂无房间，创建一个邀请朋友吧。</p>'}</div></section></div>`; }
function roomView(){
 const owner = room.owner_id===playerId;
 if(room.game_id && gameView){
   localStorage.setItem('cheese_player_id',playerId); localStorage.setItem('cheese_room_id',room.id);
   localStorage.setItem('holdem_device_id',playerId); localStorage.setItem('holdem_player_name',name); localStorage.setItem('holdem_player_emoji',avatar); localStorage.setItem('holdem_room_id',room.id);
   const url=room.game_id==='cheese' ? '/cheese/' : room.game_id==='bluff' ? `/bluff/?room=${encodeURIComponent(room.id)}` : `/holdem/room/${encodeURIComponent(room.id)}`;
   return `<div class="gamebar"><div><strong>房间 ${esc(room.id)}</strong><div id="switch-note" class="muted"></div></div><div class="row"><button class="secondary" id="room-view">返回房间</button>${owner?'<button id="switch-btn">切换游戏</button>':''}</div></div><iframe title="游戏" class="game-frame" src="${url}"></iframe>`;
 }
 const members=Object.entries(room.members);
 return `<div class="stack"><section class="card"><div class="row"><h2>房间 ${esc(room.id)}</h2><span class="muted">${members.length}/12 人 · ${owner?'你是房主':'房主：'+esc(room.members[room.owner_id]?.name)}</span><button class="secondary" id="copy">复制房间号</button><button class="danger" id="leave">离开房间</button>${room.game_id?'<button id="resume">返回游戏</button>':''}</div><div class="players">${members.map(([id,p])=>`<span class="player ${p.connected?'':'offline'}">${esc(p.avatar)} ${esc(p.name)}${id===room.owner_id?' 👑':''}${id===playerId?'（我）':''}${p.connected?'':' · 离线'}</span>`).join('')}</div>${room.game_id?`<p class="muted">当前游戏：${room.game_id==='cheese'?'奶酪大盗':room.game_id==='bluff'?'瞎掰王':'Holdem 筹码'} · ${room.can_switch?'已结束，可切换':'进行中'}</p>`:''}</section>${owner && (!room.game_id || room.can_switch) ? `<section class="card"><h2>选择游戏</h2><div class="games"><button class="game" id="choose-cheese"><strong>🧀 奶酪大盗</strong><span>5–8 人 · 推理与投票</span></button><button class="game" id="choose-bluff"><strong>🎭 瞎掰王</strong><span>3–9 人 · 线下即兴推理</span></button><button class="game" id="choose-holdem"><strong>🃏 Holdem 筹码</strong><span>最多 12 座 · 线下筹码管理</span></button></div><div id="settings"></div></section>` : !owner ? '<p class="muted">等待房主选择游戏。</p>' : ''}</div>`;
}
function render(){
 root.innerHTML=`<div class="shell"><header class="top"><div><h1>🎲 一起玩 · 游戏大厅</h1><p class="muted">和朋友在同一房间切换游戏</p></div></header>${error?`<div class="error">${esc(error)}</div><br>`:''}${room?roomView():lobbyView()}</div>`;
 const el=id=>document.getElementById(id), bind=(id,fn)=>{const e=el(id);if(e)e.onclick=fn};
 const setProfile=()=>{ name=el('name')?.value.trim()||name; avatar=el('avatar')?.value.trim()||avatar; if(!name) throw Error('请先填写昵称'); localStorage.setItem('lobby_name',name); localStorage.setItem('lobby_avatar',avatar); };
 bind('create',async()=>{try{setProfile();error=''; const r=await api('/rooms',profile()); await loadRoom(r.id)}catch(e){showError(e)}});
 const join=async id=>{try{setProfile();error=''; await api(`/rooms/${encodeURIComponent(id)}/join`,profile());await loadRoom(id)}catch(e){showError(e)}};
 bind('join-code-btn',()=>join(el('join-code').value.trim())); document.querySelectorAll('.join').forEach(b=>b.onclick=()=>join(b.dataset.id)); bind('refresh',refreshRooms);
 bind('leave',async()=>{try{await api(`/rooms/${room.id}/leave`,{player_id:playerId});closeSocket();room=null;localStorage.removeItem('lobby_room_id');error='';await refreshRooms()}catch(e){showError(e)}});
 bind('copy',()=>navigator.clipboard.writeText(room.id)); bind('room-view',()=>{gameView=false;render()}); bind('switch-btn',()=>{gameView=false;render()}); bind('resume',()=>{gameView=true;render()});
 bind('choose-cheese',()=>{const target=el('settings'); target.innerHTML=`<div class="stack"><p class="muted">选择 5–8 名在线玩家，其余成员观战。</p><div class="members">${Object.entries(room.members).map(([id,p])=>`<label class="member"><span><input type="checkbox" class="pick" value="${esc(id)}" ${p.connected?'':'disabled'} ${selected.has(id)?'checked':''}>${esc(p.avatar)} ${esc(p.name)}</span></label>`).join('')}</div><label><span><input type="checkbox" id="dodo"> 启用呆呆鸟</span></label><label><span><input type="checkbox" id="see-dice" checked> 大盗可见所有点数</span></label><label>骰子面数<select id="dice">${[6,7,8,9,10].map(n=>`<option>${n}</option>`).join('')}</select></label><button id="start-cheese">开始奶酪大盗</button></div>`;target.querySelectorAll('.pick').forEach(c=>c.onchange=()=>{c.checked?selected.add(c.value):selected.delete(c.value)});el('start-cheese').onclick=()=>start('cheese',{participants:[...selected],outsider_dodobird:el('dodo').checked,thief_see_all_dice:el('see-dice').checked,max_dice:Number(el('dice').value)});});
 bind('choose-bluff',()=>{const target=el('settings');target.innerHTML=`<div class="stack"><p class="muted">选择 3–9 名在线玩家，其余成员观战。</p><div class="members">${Object.entries(room.members).map(([id,p])=>`<label class="member"><span><input type="checkbox" class="pick" value="${esc(id)}" ${p.connected?'':'disabled'} ${selected.has(id)?'checked':''}>${esc(p.avatar)} ${esc(p.name)}</span></label>`).join('')}</div><label>游戏圈数<select id="circles"><option value="1">1 圈</option><option value="2">2 圈</option><option value="3">3 圈</option></select></label><button id="start-bluff">开始瞎掰王</button></div>`;target.querySelectorAll('.pick').forEach(c=>c.onchange=()=>{c.checked?selected.add(c.value):selected.delete(c.value)});el('start-bluff').onclick=()=>start('bluff',{participants:[...selected],circles:Number(el('circles').value)});});
 bind('choose-holdem',()=>{el('settings').innerHTML=`<div class="stack"><label>小盲注<input type="number" id="sb" min="1" value="10"></label><label>初始筹码<input type="number" id="chips" min="1" value="1000"></label><label>补码阈值<input type="number" id="rebuy" min="0" value="0"></label><label>每手间隔（秒）<input type="number" id="interval" min="0" max="300" value="5"></label><label>筹码上限（0 为不限）<input type="number" id="max-chips" min="0" value="0"></label><button id="start-holdem">开始 Holdem 筹码局</button></div>`;el('start-holdem').onclick=()=>start('holdem',{sb_amount:Number(el('sb').value),initial_chips:Number(el('chips').value),rebuy_minimum:Number(el('rebuy').value),hand_interval:Number(el('interval').value),max_chips:Number(el('max-chips').value)});});
 updateControls();
}
async function start(game_id,options){try{error=''; const next=await api(`/rooms/${room.id}/game`,{player_id:playerId,game_id,options});updateRoom(next)}catch(e){showError(e)}}
(async()=>{try{ const saved=localStorage.getItem('lobby_room_id') || (await api(`/players/${encodeURIComponent(playerId)}/room`)).room_id; if(saved) await loadRoom(saved); else await refreshRooms(); }catch(e){localStorage.removeItem('lobby_room_id');room=null;await refreshRooms()} render(); poll=setInterval(async()=>{if(!room)return;try{updateRoom(await api(`/rooms/${room.id}?player_id=${encodeURIComponent(playerId)}`))}catch(e){}},2500);})();

window.addEventListener('message', e => { if (e.origin === location.origin && e.data?.type === 'return_to_lobby') { gameView=false; render(); } });
