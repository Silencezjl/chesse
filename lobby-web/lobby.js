const root = document.querySelector('#app');
const gameShell = document.querySelector('#game-shell');
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => globalThis.crypto?.randomUUID?.() || `p_${Date.now()}_${Math.random().toString(36).slice(2)}`;
const playerId = localStorage.getItem('lobby_player_id') || uid();
localStorage.setItem('lobby_player_id', playerId);
const avatars = ['🐭','🦊','🐼','🐸','🐱','🐶','🐰','🐻'];
let name = localStorage.getItem('lobby_name') || '', avatar = localStorage.getItem('lobby_avatar') || '🐭';
let games = [], room = null, screen = 'home', intent = null, preview = null, error = '', busy = false;
let socket = null, reconnect = null, connected = false, superseded = false, showGame = true, mountedSession = '';
let settingsDraft = {}, draftKey = '', invitationOpen = false, fallbackCopy = '', serverOffset = 0;
let joinCode = new URLSearchParams(location.search).get('room') || '';
let booting = true, pendingKick = null;

async function api(path, data, method = 'POST') {
  const response = await fetch(`/lobby${path}`, data === undefined ? {} : {
    method, headers: {'content-type': 'application/json'}, body: JSON.stringify(data),
  });
  let result;
  try { result = await response.json(); } catch { throw Error('服务暂时不可用，请稍后重试'); }
  if (!response.ok) {
    const detail = typeof result.detail === 'string' ? result.detail : '提交内容有误，请检查后重试';
    throw Error(detail);
  }
  return result;
}
const profile = () => ({player_id: playerId, name: name.trim(), avatar});
const info = id => games.find(g => g.id === id);
const editable = () => room && ['choosing','waiting','countdown'].includes(room.stage);
const isOwner = () => room?.owner_id === playerId;
const inviteURL = () => `${location.origin}/?room=${room.id}`;
const stageName = stage => ({choosing:'等待选游戏',waiting:'等待准备',countdown:'即将开局',playing:'游戏进行中',finished:'本局已结束'}[stage] || '等待中');
function notify(message) {
  const el = document.querySelector('#toast'); el.textContent = message;
  clearTimeout(notify.timer); notify.timer = setTimeout(() => { el.textContent = ''; }, 3200);
}
async function action(fn) {
  if (busy) return;
  busy = true; error = ''; render();
  try { await fn(); } catch(e) { error = e.message || '操作失败，请重试'; }
  finally { busy = false; render(); }
}
function saveProfile() {
  name = name.trim();
  if (!name || name.length > 12) throw Error('请输入 1–12 个字符的昵称');
  localStorage.setItem('lobby_name', name); localStorage.setItem('lobby_avatar', avatar);
}
function closeSocket() {
  clearTimeout(reconnect); reconnect = null;
  if (socket) { socket.onclose = null; socket.close(); socket = null; }
  connected = false;
}
function clearRoom() {
  closeSocket(); room = null; mountedSession = ''; gameShell.replaceChildren(); gameShell.hidden = true;
  localStorage.removeItem('lobby_room_id'); screen = 'home';
  history.replaceState(null, '', '/'); render();
}
function connect() {
  if (!room || superseded) return;
  closeSocket(); const rid = room.id;
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/lobby/rooms/${rid}/ws/${playerId}`);
  socket = ws;
  ws.onopen = () => { connected = true; render(); };
  ws.onmessage = event => {
    if (socket !== ws) return;
    try { const message = JSON.parse(event.data); if (message.type === 'room_state') updateRoom(message.data); }
    catch { error = '同步消息异常，正在恢复'; render(); }
  };
  ws.onclose = event => {
    if (socket !== ws) return;
    connected = false;
    if (event.code === 4001) {
      superseded = true; error = '此房间已在另一个标签页打开。关闭其他页面后，刷新这里即可接管。'; render(); return;
    }
    if ([4003,4403,4404,1008].includes(event.code)) {
      clearRoom(); error = '你已离开房间或被房主移出。'; render(); return;
    }
    render();
    if (room?.id === rid) reconnect = setTimeout(connect, 1800);
  };
  ws.onerror = () => {};
}
function updateRoom(next) {
  if (!next.members?.[playerId]) { clearRoom(); return; }
  const previous = room;
  if (!previous && next.stage === 'finished') showGame = false;
  room = next;
  serverOffset = next.server_time * 1000 - Date.now();
  screen = 'room';
  localStorage.setItem('lobby_room_id', next.id);
  if (previous?.session_id !== next.session_id && next.stage === 'playing') showGame = true;
  const key = `${room.id}:${room.game_id}:${room.revision}`;
  if (draftKey !== key) { settingsDraft = {...room.options}; draftKey = key; }
  render();
}
async function loadRoom(id) {
  updateRoom(await api(`/rooms/${encodeURIComponent(id)}?player_id=${encodeURIComponent(playerId)}`));
  connect(); history.replaceState(null, '', `/?room=${id}`);
}
async function refreshRoom() {
  if (!room || !connected || socket?.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({type:'refresh'}));
}
function beginCreate(gameId) { intent = {type:'create', gameId}; screen = 'profile'; error = ''; render(); }
async function inspectInvite() {
  joinCode = joinCode.trim();
  if (!/^\d{6}$/.test(joinCode)) throw Error('请输入六位数字房间号');
  preview = await api(`/rooms/${joinCode}/preview`);
  intent = {type:'join', roomId: joinCode}; screen = 'profile';
}
async function submitProfile() {
  saveProfile();
  if (intent.type === 'create') {
    const created = await api('/rooms', {...profile(), game_id: intent.gameId || null});
    await loadRoom(created.id);
  } else {
    await api(`/rooms/${intent.roomId}/join`, profile()); await loadRoom(intent.roomId);
  }
}
async function roomAction(path, body = {}) {
  if (!connected) throw Error('连接恢复后才能操作');
  const next = await api(`/rooms/${room.id}/${path}`, {player_id: playerId, ...body});
  if (next?.id) updateRoom(next);
}
function homeView() {
  return `<section class="hero"><div><div class="eyebrow">GOOD COMPANY, GREAT GAMES</div><h1 style="margin-top:12px">朋友到齐，<br>就开局。</h1><p class="muted">选个游戏，分享房间。<br>把热闹留给朋友，把流程交给我们。</p></div><div class="hero-art" aria-hidden="true"><span class="die">⚄</span><span class="die second">⚂</span></div></section>
    <div class="section-head"><h2>今晚玩什么？</h2><span>免注册 · 手机就能玩</span></div>
    <div class="games">${games.map(g => `<article class="game-card"><div class="game-cover ${g.id}"><span class="tag">${esc(g.tag)}</span><span class="game-symbol">${g.icon}</span></div><div class="game-body"><div class="game-meta"><span>${g.minimum}–${g.maximum} 人</span><span>和朋友一起</span></div><h2>${esc(g.title)}</h2><p>${esc(g.description)}</p><button data-create="${g.id}" ${busy?'disabled':''}>创建房间 <span aria-hidden="true">↗</span></button></div></article>`).join('')}</div>
    <section class="join-strip"><div><h3>朋友已经开好房间？</h3><p class="muted">输入房间号，加入他们的快乐。</p></div><form id="join-form" class="join-form"><input id="join-code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" value="${esc(joinCode)}" placeholder="六位房间号" aria-label="六位房间号" required><button ${busy?'disabled':''}>加入房间</button></form></section>
    <div class="home-foot"><span>同一个房间，一起玩下一局。</span><button class="link" id="empty-room">还没想好？先建一个空房间</button></div>`;
}
function profileView() {
  const joining = intent?.type === 'join';
  const g = info(joining ? preview?.game_id : intent?.gameId);
  const blocked = joining && !preview?.joinable;
  return `<div class="compact"><button class="link back" id="back-home">← 返回首页</button><section class="card"><div class="eyebrow">${joining?'YOU ARE INVITED':'LET’S GET TOGETHER'}</div><h2>${joining?`加入房间 ${esc(intent.roomId)}`:g?`创建${esc(g.title)}房间`:'先和朋友集合'}</h2><p class="muted">${joining?`${esc(preview.owner_name)} 的房间 · ${g?esc(g.title):'尚未选游戏'} · ${preview.count}/12 人`:'给自己起个名字，让朋友认出你。'}</p>
    ${joining?`<div class="notice">${preview.stage==='playing'?'本局进行中，请等结束后再加入。':preview.count>=12?'房间已满，请联系房主腾出位置。':'加入后入座并准备，全部准备后自动开局。'}</div>`:''}
    <form id="profile-form" class="profile-form"><label>你的昵称<input id="name" autocomplete="nickname" maxlength="12" value="${esc(name)}" placeholder="朋友怎么称呼你？" required></label><div><span style="font-size:14px">选个头像</span><div class="avatars" style="margin-top:10px">${avatars.map(a=>`<button type="button" class="avatar-pick ${avatar===a?'active':''}" data-avatar="${a}" aria-label="头像 ${a}" aria-pressed="${avatar===a}">${a}</button>`).join('')}</div></div><button ${busy||blocked?'disabled':''}>${busy?'正在进入…':joining?'加入房间':'创建房间'}</button></form>${blocked?'<button class="link" id="recheck">刷新房间状态</button>':''}</section></div>`;
}
function settingsView() {
  const g = info(room.game_id);
  if (!g) return '';
  const owner = isOwner(), canEdit = owner && editable() && connected;
  return `<details class="card" id="settings-panel"><summary>本局设置${owner?' · 点击调整':' · 房主设置'}</summary><form id="settings-form" class="settings">${g.settings.map(f=>f.type==='boolean'?`<label class="check-label">${esc(f.label)}<input id="setting-${f.key}" data-setting="${f.key}" type="checkbox" ${settingsDraft[f.key]?'checked':''} ${canEdit?'':'disabled'}></label>`:`<label>${esc(f.label)}<input id="setting-${f.key}" data-setting="${f.key}" type="number" min="${f.min}" max="${f.max}" step="1" value="${esc(settingsDraft[f.key])}" ${canEdit?'':'disabled'} required></label>`).join('')}${canEdit?`<button class="secondary" ${busy?'disabled':''}>保存设置 · 所有人重新准备</button>`:''}</form></details>`;
}
function seatView(pid, index) {
  if (!pid) return `<div class="seat empty"><span style="font-size:26px">＋</span><small>空位 ${index+1}</small></div>`;
  const p = room.members[pid];
  return `<div class="seat ${p.ready?'ready':''} ${p.connected?'':'offline'}"><span class="face">${esc(p.avatar)}</span>${pid===room.owner_id?'<span class="crown" title="房主">♛</span>':''}<strong>${esc(p.name)}${pid===playerId?' · 我':''}</strong><small>${!p.connected?'暂时离线':p.ready?'✓ 已准备':'等待准备'}</small>${isOwner()&&editable()&&pid!==playerId?`<button class="link" data-seat="${esc(pid)}" data-seated="false" ${!connected||busy?'disabled':''}>移至观战</button>`:''}</div>`;
}
function inviteView() {
  return `<section class="card invite-panel"><div class="eyebrow">SAVE A SEAT FOR FRIENDS</div><p>邀请朋友，一起入座</p><div class="room-code">${room.id}</div><div class="invite-actions"><button class="secondary" id="copy-code">复制房间号</button><button id="copy-link">复制链接</button></div><button class="link" id="toggle-qr">${invitationOpen?'收起二维码':'面对面？扫码加入'}</button>${invitationOpen?'<div class="qr" id="qr-code" aria-label="房间邀请二维码"></div>':''}${fallbackCopy?`<div class="copy-fallback">长按或选中复制：<br>${esc(fallbackCopy)}</div>`:''}</section>`;
}
function actionView() {
  const me = room.members[playerId], g = info(room.game_id), seated = room.seats.includes(playerId);
  const participants = room.seats.map(pid=>room.members[pid]);
  const unready = room.seats.filter(pid=>!room.members[pid].ready);
  let title = '', subtitle = '', button = '';
  if (room.stage==='playing') { title='朋友们正在游戏中'; subtitle='查看房间不会结束本局'; button='<button id="resume">返回游戏 →</button>'; }
  else if (room.stage==='finished') { title='这一局，玩得怎么样？'; subtitle=isOwner()?'准备下一局，也可以换个游戏':'等待房主开启下一局'; button=isOwner()?`<button id="next-session" ${!connected||busy?'disabled':''}>再来一局 / 换游戏</button>`:room.session_members?.includes(playerId)?'<button data-resume>查看本局结果</button>':'<button disabled>等待下一局</button>'; }
  else if (!g) { title='先选个游戏吧'; subtitle=isOwner()?'选好游戏后，大家就可以准备了':'等待房主选择游戏'; button='<button disabled>等待选游戏</button>'; }
  else if (!seated) { title='你正在观战席'; subtitle='入座后就能准备参与本局'; button=`<button data-seat="${playerId}" data-seated="true" ${!connected||busy||room.seats.length>=g.maximum?'disabled':''}>${room.seats.length>=g.maximum?'座位已满':'我要参与'}</button>`; }
  else { title = room.stage==='countdown'?'全部准备，马上开局！':participants.length<g.minimum?`还差 ${g.minimum-participants.length} 位玩家`:`${participants.filter(p=>p.ready).length}/${participants.length} 位玩家已准备`;
    subtitle=room.stage==='countdown'?'取消准备可以暂停开局':unready.length?`等待 ${unready.map(pid=>room.members[pid].name).join('、')}`:'等待连接恢复';
    button=`${room.stage==='countdown'?'<span class="countdown-number" id="countdown-number"></span>':''}<button id="ready" class="${me.ready?'secondary':''}" ${!connected||busy?'disabled':''}>${me.ready?'取消准备':'准备好了'}</button>`;
  }
  return `<div class="action-bar"><div class="action-inner"><div><p>${title}</p><small>${esc(subtitle)}</small></div><div class="row">${button}</div></div></div>`;
}
function roomView() {
  const g=info(room.game_id), seated=room.seats.includes(playerId), canEdit=editable();
  const count=g?Math.max(g.minimum,room.seats.length):room.seats.length;
  const observers=Object.keys(room.members).filter(p=>!room.seats.includes(p));
  return `<div class="room-head"><div><div class="eyebrow">YOUR TABLE, YOUR FRIENDS</div><h1>房间 <span class="room-code">${room.id}</span></h1><div class="status" style="margin-top:10px"><span class="dot ${connected?'':'off'}"></span>${connected?'实时同步中':superseded?'当前标签页已暂停':'连接恢复中…'} · ${stageName(room.stage)}</div></div><button class="danger" id="leave" ${room.stage==='playing'||!connected||busy?'disabled':''}>离开房间</button></div>
    ${room.start_error?`<div class="error">${esc(room.start_error)}</div>`:''}${room.stage==='finished'&&room.session_members?.includes(playerId)?'<button class="link back" id="resume">查看上局结果 →</button>':''}
    <div class="room-layout"><div class="stack"><section class="card"><div class="row"><div class="game-heading"><span class="mini-symbol">${g?.icon||'🎲'}</span><div><h2>${g?esc(g.title):'今晚玩什么？'}</h2><p class="muted" style="font-size:12px;margin-top:4px">${g?`${g.minimum}–${g.maximum} 人参与 · 其余成员观战`:'先集合，再决定也没关系'}</p></div></div><span class="badge">${stageName(room.stage)}</span></div>
    ${isOwner()&&canEdit?`<details id="game-picker" style="margin-top:18px" ${g?'':'open'}><summary>${g?'换个游戏':'选择游戏'}</summary><div class="room-list-games" style="margin-top:12px">${games.map(game=>`<button data-game="${game.id}" class="${game.id===room.game_id?'selected':''}" ${!connected||busy?'disabled':''}>${game.icon} ${esc(game.title)}</button>`).join('')}</div></details>`:!g?'<p class="muted" style="margin-top:16px">等待房主选游戏。</p>':''}
    <div class="section-head" style="margin-bottom:0"><h3>参与玩家 <span class="muted">${room.seats.length}${g?` / ${g.maximum}`:''}</span></h3>${seated&&canEdit?`<button class="link" data-seat="${playerId}" data-seated="false" ${!connected||busy?'disabled':''}>这局先观战</button>`:''}</div><div class="seats">${Array.from({length:count},(_,i)=>seatView(room.seats[i],i)).join('')}</div>
    ${observers.length?`<div style="margin-top:22px"><h3>观战席 <span class="muted">${observers.length} 人</span></h3><div class="spectators">${observers.map(pid=>`<span class="spectator">${esc(room.members[pid].avatar)} ${esc(room.members[pid].name)}${pid===playerId?' · 我':''}${isOwner()&&canEdit?`<button class="link" data-seat="${esc(pid)}" data-seated="true" ${!connected||busy?'disabled':''}>入座</button>`:''}</span>`).join('')}</div></div>`:''}
    ${g?`<div class="notice" style="margin-top:20px">${g.minimum} 人起玩，所有参与玩家准备后 3 秒自动开局。观众无需准备。</div>`:''}</section>
    ${settingsView()}<details class="card"><summary>第一次玩？看看流程</summary><ol class="rules-list"><li>把房间号或邀请链接发给朋友。</li><li>选择游戏，玩家入座，房主可调整参与名单。</li><li>大家点击准备，3 秒后自动进入游戏。</li><li>结束后返回这里，同房再来或换游戏。</li></ol></details></div>
    <aside class="room-aside stack">${inviteView()}<section class="card"><h3>${isOwner()?'房主管理':'房间成员'} <small>${Object.keys(room.members).length}/12</small></h3><p class="muted" style="font-size:12px;margin-top:8px">${room.members[room.owner_id].connected?`房主：${esc(room.members[room.owner_id].name)}`:'房主暂时离线，60 秒后转交在线成员；游戏中延后至结束。'}</p><div class="members-manage">${Object.entries(room.members).map(([pid,p])=>`<div class="member-manage"><span>${esc(p.avatar)} ${esc(p.name)}${pid===room.owner_id?' ♛':''}</span>${isOwner()&&pid!==playerId&&room.stage!=='playing'?`<div><button class="link" data-transfer="${esc(pid)}" ${!connected||!p.connected||busy?'disabled':''}>转交</button>${canEdit?`<button class="link" data-kick="${esc(pid)}" ${!connected||busy?'disabled':''}>移出</button>`:''}</div>`:`<small>${p.connected?'在线':'离线'}</small>`}</div>`).join('')}</div></section></aside></div>${actionView()}`;
}
function mountGame() {
  const active = room && room.session_id && room.session_members?.includes(playerId) && ['playing','finished'].includes(room.stage);
  if (!active) { gameShell.replaceChildren(); mountedSession=''; gameShell.hidden=true; return; }
  if (mountedSession !== room.session_id) {
    localStorage.setItem('cheese_player_id',playerId); localStorage.setItem('cheese_room_id',room.id);
    localStorage.setItem('holdem_device_id',playerId); localStorage.setItem('holdem_player_name',name); localStorage.setItem('holdem_player_emoji',avatar); localStorage.setItem('holdem_room_id',room.id);
    const entry = info(room.game_id)?.entry;
    const src = room.game_id==='holdem'?`${entry}room/${room.id}`:room.game_id==='bluff'?`${entry}?room=${room.id}`:entry;
    if (!src) return;
    const iframe=document.createElement('iframe');iframe.title=info(room.game_id).title;iframe.className='game-frame';iframe.src=src;
    gameShell.replaceChildren(iframe); mountedSession=room.session_id;
  }
  gameShell.hidden=!showGame;
}
function render() {
  const focus=document.activeElement;
  const saved=focus?.id?{id:focus.id,start:focus.selectionStart,end:focus.selectionEnd}:null;
  const openDetails=[...root.querySelectorAll('details[id][open]')].map(d=>d.id);
  const inGame=room&&showGame&&room.session_id&&['playing','finished'].includes(room.stage);
  document.body.classList.toggle('game-mode',Boolean(inGame));
  root.innerHTML=`<div class="shell" ${pendingKick?'inert':''}><header class="top"><a href="/" class="brand" id="brand"><span class="brand-mark">⚄</span>一起玩<span class="muted" style="font-size:12px;font-weight:450">/ 游戏小聚</span></a><span class="profile-chip">${esc(avatar)} ${esc(name||'留个座，一起玩')}</span></header>${error?`<div class="error" role="alert">${esc(error)}</div>`:''}${booting?'<p class="muted">正在为你摆好桌子…</p>':inGame?`<div class="game-toolbar"><div><strong>${info(room.game_id)?.icon} ${esc(info(room.game_id)?.title)} · ${room.id}</strong><small>${connected?stageName(room.stage):'房间连接恢复中…'}</small></div><button class="secondary" id="show-room">${room.stage==='finished'?'本局结束 · 返回房间':'查看房间'}</button></div>`:screen==='room'&&room?roomView():screen==='profile'?profileView():homeView()}</div>${pendingKick?`<div class="modal-backdrop"><section class="confirm-card card" role="dialog" aria-modal="true" aria-labelledby="kick-title"><h2 id="kick-title">移出${esc(room?.members[pendingKick]?.name||'该成员')}？</h2><p class="muted">移出后，该设备将无法再次加入这个房间。</p><div class="row"><button class="secondary" id="cancel-kick">先不移出</button><button class="danger" id="confirm-kick" ${busy?'disabled':''}>确认移出</button></div></section></div>`:''}`;
  openDetails.forEach(id=>{const el=document.getElementById(id);if(el)el.open=true;});
  bindEvents(); mountGame();
  if (invitationOpen&&document.querySelector('#qr-code')&&globalThis.qrcode) {
    const code=globalThis.qrcode(0,'M');code.addData(inviteURL());code.make();document.querySelector('#qr-code').innerHTML=code.createSvgTag({cellSize:4,margin:0,scalable:true});
  }
  if(saved){const el=document.getElementById(saved.id);if(el){el.focus({preventScroll:true});if(el.setSelectionRange&&saved.start!==null&&el.type!=='number')el.setSelectionRange(saved.start,saved.end);}}
  updateCountdown();
}
async function copy(value) {
  try { await navigator.clipboard.writeText(value); notify('已复制，发给朋友吧'); }
  catch { fallbackCopy=value; render(); notify('请长按或选中文本复制'); }
}
function bindEvents() {
  const bind=(id,event,fn)=>{const e=document.getElementById(id);if(e)e.addEventListener(event,fn);};
  bind('brand','click',e=>{if(room){e.preventDefault();showGame=false;render();}});
  root.querySelectorAll('[data-create]').forEach(b=>b.onclick=()=>beginCreate(b.dataset.create));
  bind('empty-room','click',()=>beginCreate(null));
  bind('join-code','input',e=>{joinCode=e.target.value.replace(/\D/g,'');e.target.value=joinCode;});
  bind('join-form','submit',e=>{e.preventDefault();action(inspectInvite);});
  bind('back-home','click',()=>{screen='home';error='';history.replaceState(null,'','/');render();});
  bind('name','input',e=>{name=e.target.value;});
  root.querySelectorAll('[data-avatar]').forEach(b=>b.onclick=()=>{avatar=b.dataset.avatar;render();});
  bind('profile-form','submit',e=>{e.preventDefault();action(submitProfile);});
  bind('recheck','click',()=>action(inspectInvite));
  bind('leave','click',()=>action(async()=>{await roomAction('leave');clearRoom();}));
  root.querySelectorAll('[data-resume]').forEach(b=>b.onclick=()=>{showGame=true;render();});
  bind('show-room','click',()=>{showGame=false;render();});bind('resume','click',()=>{showGame=true;render();});
  bind('ready','click',()=>action(()=>roomAction('ready',{ready:!room.members[playerId].ready,revision:room.revision})));
  bind('next-session','click',()=>action(async()=>{await roomAction('return');showGame=false;}));
  root.querySelectorAll('[data-seat]').forEach(b=>b.onclick=()=>action(()=>roomAction('seat',{target_id:b.dataset.seat,seated:b.dataset.seated==='true'})));
  root.querySelectorAll('[data-game]').forEach(b=>b.onclick=()=>action(()=>roomAction('game',{game_id:b.dataset.game,options:{}})));
  root.querySelectorAll('[data-setting]').forEach(input=>input.oninput=()=>{settingsDraft[input.dataset.setting]=input.type==='checkbox'?input.checked:Number(input.value);});
  bind('settings-form','submit',e=>{e.preventDefault();action(()=>roomAction('game',{game_id:room.game_id,options:settingsDraft}));});
  bind('copy-code','click',()=>copy(room.id));bind('copy-link','click',()=>copy(inviteURL()));
  bind('toggle-qr','click',()=>{invitationOpen=!invitationOpen;render();});
  root.querySelectorAll('[data-transfer]').forEach(b=>b.onclick=()=>action(()=>roomAction('manage?action=transfer',{target_id:b.dataset.transfer})));
  root.querySelectorAll('[data-kick]').forEach(b=>b.onclick=()=>{pendingKick=b.dataset.kick;render();document.getElementById('cancel-kick')?.focus();});
  bind('cancel-kick','click',()=>{pendingKick=null;render();});
  bind('confirm-kick','click',()=>{const target=pendingKick;action(async()=>{await roomAction('manage?action=kick',{target_id:target});pendingKick=null;});});
}
function updateCountdown(){const el=document.getElementById('countdown-number');if(el&&room?.countdown)el.textContent=Math.max(0,Math.ceil((room.countdown.deadline*1000-Date.now()-serverOffset)/1000));}
setInterval(updateCountdown,100);
setInterval(()=>{if(connected&&socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify({type:'ping'}));},15000);
setInterval(refreshRoom,5000);
window.addEventListener('online',()=>{if(room&&!connected&&!superseded)connect();});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&room&&!superseded){if(!connected)connect();else refreshRoom();}});
window.addEventListener('message',e=>{if(e.origin===location.origin&&e.source===gameShell.querySelector('iframe')?.contentWindow&&e.data?.type==='return_to_lobby'){showGame=false;render();refreshRoom();}});
(async()=>{
  try {
    games=await api('/games');
    const saved=(await api(`/players/${playerId}/room`)).room_id;
    if(saved){await loadRoom(saved);if(joinCode&&joinCode!==saved)notify('你还在另一房间，已为你恢复。');}
    else if(joinCode){await inspectInvite();}
  }catch(e){error=e.message;}
  finally{booting=false;render();}
})();

document.addEventListener('keydown',e=>{if(!pendingKick)return;if(e.key==='Escape'){pendingKick=null;render();}else if(e.key==='Tab'){const buttons=[...root.querySelectorAll('[role=dialog] button:not(:disabled)')];if(buttons.length){e.preventDefault();const i=buttons.indexOf(document.activeElement);buttons[(i+(e.shiftKey?-1:1)+buttons.length)%buttons.length].focus();}}});
