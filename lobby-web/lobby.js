const root = document.querySelector('#app');
const gameShell = document.querySelector('#game-shell');
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => globalThis.crypto?.randomUUID?.() || `p_${Date.now()}_${Math.random().toString(36).slice(2)}`;
const playerId = localStorage.getItem('lobby_player_id') || uid();
localStorage.setItem('lobby_player_id', playerId);
const avatars = GameAvatars.ids;
let name = PlayerNames.text(localStorage.getItem('lobby_name')).trim(), avatar = GameAvatars.normalize(localStorage.getItem('lobby_avatar'));
let games = [], rooms = [], room = null, error = '', listError = '', busy = false, booting = true;
let socket = null, reconnect = null, connected = false, superseded = false, showGame = true, mountedSession = '';
let settingsDraft = {}, draftKey = '', serverOffset = 0, sheet = null, pendingKick = null;
let draftName = '', draftAvatar = '', password = '', targetRoom = null, gameConnected = false;
let listing = false, lastFocus = null, restartChoose = false;
const rejectedNames = new Set();
const randomNickname = () => PlayerNames.random(draftName,[...Object.entries(room?.members || {}).filter(([id])=>id!==playerId).map(([,p])=>p.name),...rejectedNames,...(sheet==='join'&&targetRoom?.owner_name?[targetRoom.owner_name]:[])]);


let observedActionBar=null;
function measureActionBar(){
  const bar=root.querySelector('.action-bar');
  document.body.style.setProperty('--action-bar-height',`${bar?Math.ceil(bar.getBoundingClientRect().height):0}px`);
}
const actionBarObserver=typeof ResizeObserver==='function'?new ResizeObserver(measureActionBar):null;
function syncScrollLayout(){
  const bar=root.querySelector('.action-bar');
  document.body.classList.toggle('has-action-bar',Boolean(bar));
  document.documentElement.classList.toggle('game-viewport',document.body.classList.contains('game-mode'));
  document.documentElement.classList.toggle('sheet-open',Boolean(root.querySelector('[role=dialog]')));
  if(bar!==observedActionBar){actionBarObserver?.disconnect();observedActionBar=bar;if(bar)actionBarObserver?.observe(bar);}
  measureActionBar();
}
window.addEventListener('resize',measureActionBar);

let fullscreenPending=false;
const fullscreenElement=()=>document.fullscreenElement || document.webkitFullscreenElement;
const canFullscreen=()=>Boolean((document.documentElement.requestFullscreen && document.fullscreenEnabled!==false) || (document.documentElement.webkitRequestFullscreen && document.webkitFullscreenEnabled!==false));
const fullscreenIcon=active=>`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${active?'M8 3v5H3m13-5v5h5M3 16h5v5m8 0v-5h5':'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5'}"/></svg>`;
function fullscreenButton(context='header'){
  const active=Boolean(fullscreenElement()),label=active?'退出全屏':canFullscreen()?'进入全屏':'全屏说明';
  return `<button type="button" class="secondary fullscreen-toggle" id="fullscreen-${context}" data-fullscreen aria-label="${label}" title="${label}" aria-pressed="${active}" ${fullscreenPending?'disabled':''}>${fullscreenIcon(active)}</button>`;
}
function paintFullscreen(){
  const active=Boolean(fullscreenElement()),label=active?'退出全屏':canFullscreen()?'进入全屏':'全屏说明';
  root.querySelectorAll('[data-fullscreen]').forEach(button=>{button.setAttribute('aria-label',label);button.title=label;button.setAttribute('aria-pressed',String(active));button.disabled=fullscreenPending || Boolean(busy&&(sheet||pendingKick));button.innerHTML=fullscreenIcon(active);});
}
async function toggleFullscreen(){
  if(fullscreenPending)return;
  if(!fullscreenElement()&&!canFullscreen()){openSheet('fullscreen-info');return;}
  fullscreenPending=true;paintFullscreen();
  try{
    if(fullscreenElement()){
      const exit=document.exitFullscreen || document.webkitExitFullscreen;await exit.call(document);
    }else if(document.documentElement.requestFullscreen){
      // Request synchronously from the click, before any network or render work.
      await document.documentElement.requestFullscreen({navigationUI:'hide'});
    }else await document.documentElement.webkitRequestFullscreen();
  }catch{notify('浏览器未允许全屏，请再次点击；也可以继续使用普通模式。');}
  finally{fullscreenPending=false;paintFullscreen();}
}
document.addEventListener('fullscreenchange',paintFullscreen);
document.addEventListener('webkitfullscreenchange',paintFullscreen);

let latency=null, latencyState='measuring', pingSerial=0, pendingPing=null, httpPing=null;
const pingClock=()=>performance.now();
function latencyLabel(){return latency===null?({measuring:'测量中',offline:'未连接',timeout:'超时',paused:'已暂停'}[latencyState] || '未连接'):`${latency}ms`;}
function latencyLevel(){return latency===null?(latencyState==='timeout'||latencyState==='offline'?'bad':'unknown'):latency<100?'good':latency<300?'fair':'bad';}
function latencyView(){return `<span class="latency-badge" data-level="${latencyLevel()}" title="当前客户端到服务器的往返延迟"><span class="latency-label">延迟 ${latencyLabel()}</span></span>`;}
function paintLatency(){
  root.querySelectorAll('.latency-badge').forEach(el=>{el.dataset.level=latencyLevel();el.querySelector('.latency-label').textContent=`延迟 ${latencyLabel()}`;el.setAttribute('aria-label',`客户端到服务器往返延迟：${latencyLabel()}`);});
}
function setLatency(value,state='ready'){latency=value;latencyState=state;paintLatency();}
function resetLatency(state='measuring'){
  const request=httpPing;httpPing=null;request?.abort();pendingPing=null;setLatency(null,state);
}
function pingRoom(ws){
  if(ws!==socket || ws.readyState!==WebSocket.OPEN || document.hidden || superseded)return;
  if(pendingPing){
    if(pingClock()-pendingPing.started<10000)return;
    pendingPing=null;setLatency(null,'timeout');
  }
  const id=++pingSerial;pendingPing={id,started:pingClock()};
  ws.send(JSON.stringify({type:'ping',id}));
}
async function probeLatency(){
  if(document.hidden)return;
  if(navigator.onLine===false){resetLatency('offline');return;}
  if(room){if(connected&&socket?.readyState===WebSocket.OPEN)pingRoom(socket);return;}
  if(httpPing)return;
  const request=new AbortController();httpPing=request;const started=pingClock();
  const timeout=setTimeout(()=>request.abort(),8000);
  try{
    const response=await fetch('/lobby/ping',{cache:'no-store',signal:request.signal});
    const message=await response.json();if(!response.ok || message.type!=='pong')throw Error('Ping failed');
    if(httpPing===request&&!room&&!document.hidden)setLatency(Math.max(1,Math.round(pingClock()-started)));
  }catch(e){if(httpPing===request&&!room&&!document.hidden)setLatency(null,e.name==='AbortError'?'timeout':'offline');}
  finally{clearTimeout(timeout);if(httpPing===request)httpPing=null;}
}


async function api(path, data) {
  const response = await fetch(`/lobby${path}`, data === undefined ? {} : {
    method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(data),
  });
  let result;
  try { result = await response.json(); } catch { throw Error('服务暂时不可用，请稍后重试'); }
  if (!response.ok) {const failure=Error(typeof result.detail==='string'?result.detail:result.detail?.message || '提交内容有误，请检查后重试');failure.code=result.detail?.code;throw failure;}
  return result;
}
const profile = () => ({player_id:playerId, name:name.trim(), avatar});
const info = id => games.find(g => g.id === id);
const gameIcon = (g, className='game-icon') => `<img class="${className}" src="${esc(g?.icon || '/assets/party-logo-indigo-v1.webp')}" alt="" width="64" height="64" decoding="async">`;
const editable = () => room && ['choosing','waiting','countdown'].includes(room.stage);
const isOwner = () => room?.owner_id === playerId;
const pending = () => room?.pending_member_ids?.includes(playerId);
const inSession = () => room?.session_members?.includes(playerId);
const roomTitle = r => `${r?.owner_name || r?.members?.[r.owner_id]?.name || '朋友'}的房间`;
const stageName = stage => ({choosing:'等待选游戏',waiting:'等待准备',countdown:'即将开局',playing:'游戏进行中',finished:'本局已结束'}[stage] || '等待中');
function notify(message) {
  const el=document.querySelector('#toast'); el.textContent=message;
  clearTimeout(notify.timer); notify.timer=setTimeout(()=>{el.textContent='';},3200);
}
async function action(fn) {
  if(busy)return;
  busy=true;error='';render();
  try{await fn();}catch(e){error=e.message || '操作失败，请重试';}
  finally{busy=false;render();}
}
function saveProfile() {
  name=name.trim();
  localStorage.setItem('lobby_name',name);localStorage.setItem('lobby_avatar',avatar);
}
function closeSocket() {
  resetLatency();
  clearTimeout(reconnect);reconnect=null;
  if(socket){socket.onclose=null;socket.close();socket=null;}
  connected=false;
}
function clearRoom() {
  closeSocket();sheet=null;pendingKick=null;room=null;mountedSession='';gameConnected=false;gameShell.replaceChildren();gameShell.hidden=true;
  localStorage.removeItem('lobby_room_id');history.replaceState(null,'','/');render();refreshList();probeLatency();
}
function connect() {
  if(!room || superseded)return;
  closeSocket();const rid=room.id;
  const ws=new WebSocket(`${location.protocol==='https:'?'wss:':'ws:'}//${location.host}/lobby/rooms/${rid}/ws/${playerId}`);
  socket=ws;
  ws.onopen=()=>{if(socket!==ws)return;connected=false;pingRoom(ws);};
  ws.onmessage=event=>{
    if(socket!==ws)return;
    try{const m=JSON.parse(event.data);if(m.type==='room_state'){connected=true;updateRoom(m.data);}
      else if(m.type==='pong'&&pendingPing&&m.id===pendingPing.id){const elapsed=pingClock()-pendingPing.started;pendingPing=null;if(elapsed>=10000)setLatency(null,'timeout');else if(!document.hidden)setLatency(Math.max(1,Math.round(elapsed)));}}
    catch{error='同步消息异常，正在恢复';render();}
  };
  ws.onclose=event=>{
    if(socket!==ws)return;connected=false;resetLatency('offline');
    if(event.code===4001){superseded=true;conceal();showGame=false;sheet=null;error='此房间已在另一个标签页打开，刷新这里即可接管。';render();return;}
    if([4003,4403,4404,1008].includes(event.code)){sheet=null;pendingKick=null;clearRoom();error='你已离开房间或被房主移出。';render();return;}
    render();if(room?.id===rid)reconnect=setTimeout(connect,1800);
  };
  ws.onerror=()=>{};
}
function updateRoom(next) {
  if(!next.members?.[playerId]){clearRoom();return;}
  const previous=room;room=next;
  if(!previous || previous.stage!==next.stage){pendingKick=null;if(next.stage==='playing')sheet=null;}
  if(!previous && next.stage==='finished')showGame=false;
  if(previous?.session_id!==next.session_id && next.stage==='playing')showGame=true;
  if(pending())showGame=false;
  serverOffset=next.server_time*1000-Date.now();
  localStorage.setItem('lobby_room_id',next.id);
  const me=next.members[playerId];name=PlayerNames.text(me.name);avatar=GameAvatars.normalize(me.avatar);saveProfile();
  const key=`${room.id}:${room.game_id}:${room.revision}`;
  if(draftKey!==key){settingsDraft={...room.options};draftKey=key;}
  render();
}
async function loadRoom(id) {
  updateRoom(await api(`/rooms/${encodeURIComponent(id)}?player_id=${encodeURIComponent(playerId)}`));
  connect();history.replaceState(null,'','/');
}
function refreshRoom() {
  if(room && connected && socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify({type:'refresh'}));
}
async function refreshList() {
  if(listing || room || document.hidden)return;
  listing=true;
  try{rooms=await api('/rooms');listError='';}catch(e){listError=e.message;}
  finally{listing=false;if(!room)render();}
}
function openSheet(type, target=null) {
  lastFocus=document.activeElement?.id;sheet=type;error='';password='';targetRoom=target;
  draftName=type==='onboarding'?'':name;draftAvatar=avatar;render();
  (root.querySelector('[role=dialog] input') || root.querySelector('[role=dialog] button'))?.focus({preventScroll:true});
}
function closeSheet(){if(sheet==='onboarding')return;sheet=null;pendingKick=null;password='';error='';render();document.getElementById(lastFocus)?.focus();}
function beginCreate(gameId='') {
  if(!name){openSheet('onboarding');return;}
  return action(async()=>{const created=await api('/rooms',{...profile(),game_id:gameId || null});await loadRoom(created.id);sheet=null;});
}
async function joinWithSavedProfile(target, roomPassword='') {
  const original=name;let nextName=name;
  for(let attempt=0;attempt<13;attempt++){
    try{
      await api(`/rooms/${target.id}/join`,{...profile(),name:nextName,password:roomPassword});
    }catch(e){
      if(e.code!=='nickname_taken')throw e;
      rejectedNames.add(nextName);nextName=PlayerNames.random(nextName,[target.owner_name,...rejectedNames]);continue;
    }
    name=nextName;saveProfile();await loadRoom(target.id);
    if(nextName!==original)notify(`昵称重名，已改为“${nextName}”`);
    return;
  }
  throw Error('暂时无法生成可用昵称，请在右上角修改昵称后重试');
}
async function beginJoin(id) {
  if(!name){openSheet('onboarding');return;}
  targetRoom=await api(`/rooms/${encodeURIComponent(id)}/preview`);
  if(!targetRoom.joinable)throw Error('房间已满，请选择其他房间');
  if(targetRoom.has_password){openSheet('join',targetRoom);return;}
  await joinWithSavedProfile(targetRoom);
}
async function submitProfile() {
  const nextName=PlayerNames.text(draftName).trim();
  if(!nextName || nextName.length>12)throw Error('请输入 1–12 个字符的昵称');
  if(room)await roomAction('profile',{player_id:playerId,name:nextName,avatar:draftAvatar});
  name=nextName;avatar=draftAvatar;saveProfile();sheet=null;
}
async function submitRoom() {
  if(!name){openSheet('onboarding');return;}
  await joinWithSavedProfile(targetRoom,password);
  sheet=null;password='';
}

async function roomAction(path,body={}) {
  if(!connected)throw Error('连接恢复后才能操作');
  const next=await api(`/rooms/${room.id}/${path}`,{player_id:playerId,...body});if(next?.id)updateRoom(next);
}
function homeView() {
  return `<section class="home-intro"><div><h1>朋友到齐，就开玩。</h1><p class="muted">找到朋友的名字，直接加入他们。</p></div><button id="create-room" ${busy?'disabled':''}>＋ 创建房间</button></section>
  <div class="section-head"><h2>房间列表 <small>${rooms.length} 间</small></h2><button class="secondary" id="refresh-list">刷新</button></div>
  ${listError?`<div class="error" role="alert">${esc(listError)} · 点击刷新重试</div>`:''}
  <div class="room-cards">${rooms.length?rooms.map(r=>`<article class="room-card"><div class="room-face">${GameAvatars.html(r.owner_avatar)}</div><div class="room-summary"><h3>${PlayerNames.html(roomTitle(r))} ${r.has_password?'<span aria-label="有密码">🔒</span>':''}</h3><p>${esc(info(r.game_id)?.title || '还没选游戏')} · ${r.count}/${r.capacity || 12} 人</p><span class="badge">${!r.joinable?'房间已满':r.stage==='playing'?'游戏中 · 可候场':stageName(r.stage)}</span></div><button data-join="${esc(r.id)}" ${busy||!r.joinable?'disabled':''}>${!r.joinable?'已满':r.stage==='playing'?'候场':'加入'}</button></article>`).join(''):`<div class="empty-state" role="status"><p class="muted">暂无房间，创建后会显示在这里。</p></div>`}</div>
  <div class="section-head"><h2>今晚玩什么？</h2><span>免注册 · 手机就能玩</span></div><div class="game-shortcuts">${games.map(g=>`<button class="game-shortcut" data-create="${g.id}" ${busy?'disabled':''}>${gameIcon(g)}<strong>${esc(g.title)}</strong><small>${g.minimum}–${g.maximum} 人 · ${esc(g.tag)}</small></button>`).join('')}</div>`;
}
function settingsView() {
  const g=info(room.game_id);if(!g)return '';
  const canEdit=isOwner()&&editable()&&connected;
  return `<form id="settings-form" class="settings">${g.settings.map(f=>f.type==='boolean'?`<label class="check-label">${esc(f.label)}<input id="setting-${f.key}" data-setting="${f.key}" type="checkbox" ${settingsDraft[f.key]?'checked':''} ${canEdit?'':'disabled'}></label>`:`<label>${esc(f.label)}<input id="setting-${f.key}" data-setting="${f.key}" type="number" min="${f.min}" max="${f.max}" step="1" value="${esc(settingsDraft[f.key])}" ${canEdit?'':'disabled'} required></label>`).join('')}${canEdit?'<button>保存设置 · 全员重新准备</button>':''}</form>`;
}
function seatView(pid,index) {
  if(!pid)return `<div class="seat empty"><span>＋</span><small>等待朋友入座</small></div>`;
  const p=room.members[pid];
  return `<button class="seat ${p.ready?'ready':''} ${p.connected?'':'offline'}" data-member="${esc(pid)}"><span class="face">${GameAvatars.html(p.avatar)}</span>${pid===room.owner_id?'<span class="crown" title="房主">♛</span>':''}<strong>${PlayerNames.html(p.name)}${pid===playerId?' · 我':''}</strong><small>${!p.connected?'暂时离线':p.ready?'✓ 已准备':'等待准备'}</small></button>`;
}
function actionView() {
  const me=room.members[playerId],g=info(room.game_id),seated=room.seats.includes(playerId);
  const participants=room.seats.map(pid=>room.members[pid]);
  const unready=room.seats.filter(pid=>!room.members[pid].ready);
  let title='',subtitle='',button='';
  if(room.stage==='playing'){
    title=pending()?'已为你留好下一局':'朋友们正在游戏中';subtitle=pending()?'本局结束后，回到等待室入座':'查看房间不会结束本局';
    button=inSession()?'<button id="resume">返回游戏</button>':'<button disabled>等待下一局</button>';
  }else if(room.stage==='finished'){
    title='这一局，玩得怎么样？';subtitle=isOwner()?'回到等待室，大家重新准备':'等待房主开启下一局';
    button=isOwner()?'<button id="next-session">再来一局</button><button class="secondary" id="switch-session">换游戏</button>':inSession()?'<button data-resume>查看结果</button>':'<button disabled>等待下一局</button>';
  }else if(!g){title='先选个游戏吧';subtitle=isOwner()?'选好游戏，大家就可以准备了':'等待房主选择游戏';button='<button disabled>等待选游戏</button>';}
  else if(!seated){title='这局先旁观';subtitle='入座后就能准备参与本局';button=`<button data-seat="${playerId}" data-seated="true" ${room.seats.length>=g.maximum?'disabled':''}>${room.seats.length>=g.maximum?'座位已满':'我要参与'}</button>`;}
  else{
    title=room.stage==='countdown'?'全部准备，马上开局！':participants.length<g.minimum?`还差 ${g.minimum-participants.length} 位玩家`:`${participants.filter(p=>p.ready).length}/${participants.length} 位玩家已准备`;
    subtitle=room.stage==='countdown'?'取消准备可以暂停开局':participants.some(p=>!p.connected)?'等待玩家连接恢复':unready.length?`等待 ${unready.slice(0,2).map(pid=>room.members[pid].name).join('、')}${unready.length>2?` 等 ${unready.length} 人`:''}`:'马上开局';
    button=`${room.stage==='countdown'?'<span class="countdown-number" id="countdown-number"></span>':''}<button id="ready" class="${me.ready?'secondary':''}">${me.ready?'取消准备':'准备好了'}</button>`;
  }
  return `<div class="action-bar"><div class="action-inner"><div><p>${PlayerNames.html(title)}</p><small>${PlayerNames.html(subtitle)}</small></div><div class="row">${button}</div></div></div>`;
}
function rulesView() {
  const g=info(room?.game_id);if(!g)return '<p class="muted">选择游戏后，这里会显示玩法说明。</p>';
  return `<div class="rules-content">${g.rules?.length?g.rules.map(section=>`<section><h3>${esc(section.title)}</h3><ul>${section.items.map(item=>`<li>${esc(item)}</li>`).join('')}</ul></section>`).join(''):`<p>${esc(g.description)}</p>`}<p class="rules-settings">本局设置：${g.settings.map(field=>`${esc(field.label)} ${field.type==='boolean'?(room.options[field.key]?'开启':'关闭'):esc(room.options[field.key] ?? field.default)}`).join(' · ')}</p></div>`;
}
function roomView() {
  const g=info(room.game_id),observers=Object.keys(room.members).filter(p=>!room.seats.includes(p));
  return `<div class="room-head"><div><h1>${PlayerNames.html(roomTitle(room))}</h1><div class="status"><span class="dot ${connected?'':'off'}"></span>${connected?stageName(room.stage):superseded?'当前标签页已暂停':'连接恢复中…'} · ${Object.keys(room.members).length}/12 人 ${room.has_password?'· 🔒':''}</div></div><button class="secondary" id="room-menu">更多</button></div>
  ${room.start_error?`<div class="error">${esc(room.start_error)}</div>`:''}
  ${pending()?'<div class="notice">你已加入候场。本局信息暂不开放，结束后可以入座。</div>':''}
  <section class="card table-card"><div class="row"><div class="game-heading">${gameIcon(g,'game-icon room-game-icon')}<div><h2>${esc(g?.title || '今晚玩什么？')}</h2><p class="muted">${g?`${g.minimum}–${g.maximum} 人参与`:'先集合，再决定也没关系'}</p></div></div>${isOwner()&&editable()?'<button class="link" id="game-picker">选游戏</button>':''}</div>
  <div class="section-head"><h3>参与玩家 <small>${room.seats.length}</small></h3>${room.seats.includes(playerId)&&editable()?`<button class="link" data-seat="${playerId}" data-seated="false">这局先旁观</button>`:''}</div>
  <div class="seats">${Array.from({length:Math.max(room.seats.length,g?.minimum || 1)},(_,i)=>seatView(room.seats[i],i)).join('')}</div>
  ${observers.length?`<div class="section-head"><h3>旁观与候场 <small>${observers.length}</small></h3></div><div class="spectators">${observers.map(pid=>`<button class="spectator secondary" data-member="${esc(pid)}">${GameAvatars.html(room.members[pid].avatar)} ${PlayerNames.html(room.members[pid].name)}${room.pending_member_ids?.includes(pid)?' · 候场':''}</button>`).join('')}</div>`:''}
  </section><div class="room-tools"><button class="secondary" id="open-settings" ${!g?'disabled':''}>本局设置</button><button class="secondary" id="open-rules">玩法说明</button></div>
  <p class="room-hint muted">朋友打开大厅，找到“${PlayerNames.html(roomTitle(room))}”就能加入。<br>所有人离线 15 分钟后，房间自动解散。</p>${editable()&&g?`<section class="card waiting-rules" aria-labelledby="waiting-rules-title"><h2 id="waiting-rules-title">${esc(g.title)} · 游戏规则</h2>${rulesView()}</section>`:''}${actionView()}`;
}
function sheetView() {
  if(!sheet && !pendingKick)return '';
  let title='',content='';
  if(pendingKick){title=`移出${room?.members[pendingKick]?.name || '该成员'}？`;content='<p>移出后，该设备无法再次加入本房间。</p><button class="danger" id="confirm-kick">确认移出</button><button class="secondary" id="cancel-kick">先不移出</button>';}
  else if(['onboarding','profile'].includes(sheet)){
    title=sheet==='onboarding'?'先取个昵称吧':'我的资料';
    content=`<form id="profile-form" class="profile-form">${sheet==='onboarding'?'<p class="muted">输入昵称，或点“随机”选一个。设置一次，之后开房、加入都不用再填。</p>':''}
    <div class="nickname-field"><label for="name">你的昵称</label><div class="nickname-input"><div class="nickname-editor"><input id="name" autocomplete="nickname" maxlength="12" value="${esc(draftName)}" placeholder="朋友怎么称呼你？" required></div><button type="button" class="secondary" id="random-name" aria-label="随机生成昵称">随机</button></div></div><p class="avatar-heading">选择动物头像 <small>30 款 · 上下滑动查看更多</small></p><div class="avatars" role="group" aria-label="动物头像">${avatars.map(a=>`<button type="button" class="avatar-pick ${GameAvatars.normalize(draftAvatar)===a?'active':''}" id="pick-${a}" data-avatar="${a}" aria-label="${GameAvatars.label(a)}" aria-pressed="${GameAvatars.normalize(draftAvatar)===a}">${GameAvatars.html(a)}</button>`).join('')}</div>
    <p class="muted">昵称和头像会保存在这个设备，下次自动使用。</p><button id="save-profile" ${sheet==='onboarding'&&!draftName.trim()?'disabled':''}>${busy?'正在保存…':sheet==='onboarding'?'进入大厅':'保存资料'}</button></form>`;
  }else if(sheet==='join'){
    title=`加入${roomTitle(targetRoom)}`;content=`<form id="room-form" class="stack">${targetRoom.stage==='playing'?'<p class="notice">这局正在进行，加入后等待下一局。</p>':''}<label>房间密码<input id="password" type="password" autocomplete="off" maxlength="20" value="${esc(password)}" placeholder="请输入房主设置的密码" required></label><button>${busy?'正在加入…':'加入房间'}</button></form>`;
  }else if(sheet==='settings'){title='本局设置';content=settingsView();}
  else if(sheet==='games'){title='今晚玩什么？';content=`<div class="stack">${games.map(g=>`<button class="secondary game-choice" data-game="${g.id}">${gameIcon(g)}<span>${esc(g.title)}<small>${g.minimum}–${g.maximum} 人</small></span></button>`).join('')}</div>`;}
  else if(sheet==='password'){title='房间密码';content=`<form id="password-form" class="stack"><p class="muted">${room.has_password?'已设置密码。留空保存可移除密码。':'当前无需密码即可加入。'}已有成员重连不受影响。</p><label>新密码<input type="password" id="password" autocomplete="new-password" maxlength="20" value="${esc(password)}" placeholder="留空则无需密码"></label><button>保存密码</button></form>`;}
  else if(sheet==='rules'){title='游戏规则';content=rulesView();}
  else if(sheet==='fullscreen-info'){title='全屏游玩';content='<div class="stack"><p>当前浏览器不支持网页全屏，页面会按浏览器可用高度显示。</p><p class="muted">Android 手机可使用 Chrome 并点击全屏按钮。iPhone 上的浏览器支持因系统版本而异。</p><p class="muted">网页无法固定浏览器地址栏，也不能阻止系统退出全屏。刷新页面或系统退出后，需要再次点击全屏。</p></div>';}
  else if(sheet==='member'){
    const p=room.members[targetRoom];if(!p)return '';
    title=p.name;content=`<p class="muted">${p.connected?'在线':'暂时离线'}${targetRoom===room.owner_id?' · 房主':''}</p>`;
    if(isOwner()&&editable()&&targetRoom!==playerId)content+=`<button class="secondary" data-seat="${esc(targetRoom)}" data-seated="${!room.seats.includes(targetRoom)}">${room.seats.includes(targetRoom)?'移至旁观':'安排入座'}</button><button class="secondary" data-transfer="${esc(targetRoom)}" ${!p.connected?'disabled':''}>转交房主</button><button class="danger" data-kick="${esc(targetRoom)}">移出房间</button>`;
  }else{title='房间';content=`<p class="muted">${room.members[room.owner_id].connected?'房主：'+PlayerNames.html(room.members[room.owner_id].name):'房主暂时离线，60 秒后转交在线成员；游戏中延后至结束。'}</p><button class="secondary" id="edit-profile" ${room.stage==='playing'?'disabled':''}>修改昵称与头像${room.stage==='playing'?'（本局结束后）':''}</button>${isOwner()&&editable()?'<button class="secondary" id="edit-password">设置房间密码</button>':''}${inSession()?'<button class="secondary" data-resume>返回游戏／查看结果</button>':''}<button class="danger" id="leave" ${room.stage==='playing'&&!pending()?'disabled':''}>离开房间${room.stage==='playing'&&!pending()?'（本局结束后）':''}</button>`;}
  return `<div class="modal-backdrop"><section class="confirm-card card" role="dialog" aria-modal="true" aria-labelledby="sheet-title"><div class="row"><h2 id="sheet-title">${PlayerNames.html(title)}</h2>${sheet==='onboarding'?'':'<button class="secondary" id="close-sheet" aria-label="关闭">✕</button>'}</div>${error?`<div class="error" role="alert">${esc(error)}</div>`:''}${content}</section></div>`;
}
function mountGame() {
  const active=room&&room.session_id&&inSession()&&['playing','finished'].includes(room.stage);
  if(!active){gameShell.replaceChildren();mountedSession='';gameShell.hidden=true;return;}
  if(mountedSession!==room.session_id){
    localStorage.setItem('cheese_player_id',playerId);localStorage.setItem('cheese_room_id',room.id);
    localStorage.setItem('holdem_device_id',playerId);localStorage.setItem('holdem_player_name',name);localStorage.setItem('holdem_player_emoji',avatar);localStorage.setItem('holdem_room_id',room.id);
    const entry=info(room.game_id)?.entry;
    const src=room.game_id==='holdem'?`${entry}room/${room.id}`:room.game_id==='bluff'?`${entry}?room=${room.id}`:entry;if(!src)return;
    const frame=document.createElement('iframe');frame.title=info(room.game_id).title;frame.className='game-frame';frame.src=src;
    gameConnected=false;gameShell.replaceChildren(frame);mountedSession=room.session_id;
  }
  gameShell.hidden=!showGame;
  gameShell.inert=Boolean(sheet||pendingKick||!showGame);
}
function conceal(){gameShell.querySelector('iframe')?.contentWindow?.postMessage({type:'conceal_private',session_id:mountedSession},location.origin);}
function render() {
  if(!booting&&!name&&!room&&sheet!=='onboarding'){sheet='onboarding';draftName='';draftAvatar=avatar;}
  const focus=document.activeElement,saved=focus?.id?{id:focus.id,start:focus.selectionStart,end:focus.selectionEnd}:null;
  const dialog=root.querySelector('[role=dialog]'),scroll=dialog?.scrollTop || 0;
  const avatarScroll=root.querySelector('.avatars')?.scrollTop || 0;
  const pageScroll={x:window.scrollX,y:window.scrollY};
  const inGame=room&&showGame&&inSession()&&room.session_id&&['playing','finished'].includes(room.stage);
  document.body.classList.toggle('game-mode',Boolean(inGame));
  root.innerHTML=`<div class="shell" ${sheet||pendingKick?'inert':''}><header class="top"><button class="brand" id="brand" aria-label="游戏大厅"><img class="brand-mark" src="/assets/party-logo-indigo-v1.webp" width="48" height="48" alt="" decoding="async"></button><div class="top-actions">${latencyView()}${fullscreenButton()}<button class="profile-chip secondary" id="my-profile">${GameAvatars.html(avatar)}<span>${PlayerNames.html(name || '设置我的资料')}</span></button></div></header>${error&&!sheet&&!pendingKick?`<div class="error" role="alert">${esc(error)}</div>`:''}${booting?'<p class="muted">正在为你摆好桌子…</p>':inGame?`<div class="game-toolbar"><div class="game-toolbar-title">${gameIcon(info(room.game_id))}<div><strong>${esc(info(room.game_id)?.title)}</strong><small>${!connected?'房间连接恢复中…':!gameConnected?'游戏连接恢复中…':stageName(room.stage)}</small>${latencyView()}</div></div><div class="game-toolbar-actions">${fullscreenButton('game')}<button class="secondary" id="show-room">${room.stage==='finished'?'返回房间':'查看房间'}</button></div></div>`:room?roomView():homeView()}</div>${sheetView()}`;
  syncScrollLayout();bindEvents();mountGame();
  if(!connected || busy)root.querySelectorAll('.action-bar button:not([data-resume]):not(#resume), [data-seat], [data-game], [data-transfer], [data-kick]').forEach(b=>b.disabled=true);
  if(busy)root.querySelectorAll('[role=dialog] button').forEach(b=>b.disabled=true);
  const nextDialog=root.querySelector('[role=dialog]');if(nextDialog)nextDialog.scrollTop=scroll;
  const nextAvatars=root.querySelector('.avatars');if(nextAvatars)nextAvatars.scrollTop=avatarScroll;
  if(saved){const el=document.getElementById(saved.id);if(el){el.focus({preventScroll:true});if(el.setSelectionRange&&saved.start!==null&&el.type!=='number')el.setSelectionRange(saved.start,saved.end);}}
  if(window.scrollX!==pageScroll.x || window.scrollY!==pageScroll.y)window.scrollTo(pageScroll.x,pageScroll.y);
  updateCountdown();paintLatency();paintFullscreen();
}
function bindEvents() {
  const bind=(id,event,fn)=>document.getElementById(id)?.addEventListener(event,fn);
  root.querySelectorAll('[data-fullscreen]').forEach(button=>button.onclick=toggleFullscreen);
  bind('brand','click',()=>{if(room){conceal();showGame=false;render();}});
  bind('my-profile','click',()=>{if(room?.stage==='playing'){notify('本局结束后可以修改资料');return;}openSheet('profile');});
  bind('create-room','click',()=>beginCreate());bind('refresh-list','click',refreshList);
  root.querySelectorAll('[data-create]').forEach(b=>b.onclick=()=>beginCreate(b.dataset.create));
  root.querySelectorAll('[data-join]').forEach(b=>b.onclick=()=>action(()=>beginJoin(b.dataset.join)));
  bind('close-sheet','click',closeSheet);bind('cancel-kick','click',closeSheet);
  bind('random-name','click',()=>{draftName=randomNickname();document.getElementById('name').value=draftName;document.getElementById('save-profile').disabled=busy;});
  bind('name','input',e=>{draftName=e.target.value;const save=document.getElementById('save-profile');if(save)save.disabled=busy||!draftName.trim();});bind('password','input',e=>password=e.target.value);
  root.querySelectorAll('[data-avatar]').forEach(b=>b.onclick=()=>{
    draftAvatar=b.dataset.avatar;
    root.querySelectorAll('[data-avatar]').forEach(pick=>{const selected=pick.dataset.avatar===draftAvatar;pick.classList.toggle('active',selected);pick.setAttribute('aria-pressed',String(selected));});
  });
  bind('profile-form','submit',e=>{e.preventDefault();action(submitProfile);});
  bind('room-form','submit',e=>{e.preventDefault();action(submitRoom);});
  bind('room-menu','click',()=>openSheet('menu'));bind('open-settings','click',()=>openSheet('settings'));bind('open-rules','click',()=>openSheet('rules'));bind('game-picker','click',()=>openSheet('games'));
  bind('edit-profile','click',()=>openSheet('profile'));bind('edit-password','click',()=>openSheet('password'));
  root.querySelectorAll('[data-member]').forEach(b=>b.onclick=()=>openSheet('member',b.dataset.member));
  bind('leave','click',()=>action(async()=>{await roomAction('leave');sheet=null;clearRoom();}));
  const resume=()=>{sheet=null;showGame=true;render();};
  root.querySelectorAll('[data-resume]').forEach(b=>b.onclick=resume);bind('resume','click',resume);
  bind('show-room','click',()=>{conceal();showGame=false;render();});
  bind('ready','click',()=>action(()=>roomAction('ready',{ready:!room.members[playerId].ready,revision:room.revision})));
  const nextSession=choose=>action(async()=>{if(room.game_id==='holdem'&&!sheet){restartChoose=choose;openSheet('restart');return;}await roomAction('return');showGame=false;if(choose)openSheet('games');else sheet=null;});
  bind('confirm-restart','click',()=>nextSession(restartChoose));
  bind('next-session','click',()=>nextSession(false));bind('switch-session','click',()=>nextSession(true));
  root.querySelectorAll('[data-seat]').forEach(b=>b.onclick=()=>action(async()=>{await roomAction('seat',{target_id:b.dataset.seat,seated:b.dataset.seated==='true'});sheet=null;}));
  root.querySelectorAll('[data-game]').forEach(b=>b.onclick=()=>action(async()=>{await roomAction('game',{game_id:b.dataset.game,options:{}});sheet=null;}));
  root.querySelectorAll('[data-setting]').forEach(input=>input.oninput=()=>settingsDraft[input.dataset.setting]=input.type==='checkbox'?input.checked:Number(input.value));
  bind('settings-form','submit',e=>{e.preventDefault();action(async()=>{await roomAction('game',{game_id:room.game_id,options:settingsDraft});sheet=null;});});
  bind('password-form','submit',e=>{e.preventDefault();action(async()=>{await roomAction('password',{password});sheet=null;password='';notify('房间密码已更新');});});
  root.querySelectorAll('[data-transfer]').forEach(b=>b.onclick=()=>action(async()=>{await roomAction('manage?action=transfer',{target_id:b.dataset.transfer});sheet=null;}));
  root.querySelectorAll('[data-kick]').forEach(b=>b.onclick=()=>{pendingKick=b.dataset.kick;render();document.getElementById('cancel-kick')?.focus();});
  bind('confirm-kick','click',()=>{const target=pendingKick;action(async()=>{await roomAction('manage?action=kick',{target_id:target});pendingKick=null;sheet=null;});});
}
function updateCountdown(){const el=document.getElementById('countdown-number');if(el&&room?.countdown)el.textContent=Math.max(0,Math.ceil((room.countdown.deadline*1000-Date.now()-serverOffset)/1000));}
setInterval(updateCountdown,100);
setInterval(probeLatency,5000);
// Preserve the existing room heartbeat while latency sampling is paused in background.
function keepHiddenRoomAlive(){if(document.hidden&&connected&&socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify({type:'ping'}));}
setInterval(keepHiddenRoomAlive,15000);
setInterval(()=>{if(!document.hidden){if(room)refreshRoom();else refreshList();}},5000);
window.addEventListener('offline',()=>resetLatency('offline'));
window.addEventListener('online',()=>{probeLatency();if(room&&!connected&&!superseded)connect();else if(!room)refreshList();});
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){conceal();resetLatency('paused');return;}
  setLatency(null,'measuring');
  if(room&&!superseded){if(!connected)connect();else refreshRoom();}else if(!room)refreshList();
  probeLatency();
});
window.addEventListener('message',e=>{
  if(e.origin!==location.origin||e.source!==gameShell.querySelector('iframe')?.contentWindow)return;
  if(e.data?.type==='return_to_lobby'){conceal();showGame=false;render();refreshRoom();}
  if(e.data?.type==='game_connection'){gameConnected=Boolean(e.data.connected);render();}
});
(async()=>{
  try{games=await api('/games');const saved=(await api(`/players/${playerId}/room`)).room_id;if(saved)await loadRoom(saved);else await refreshList();}
  catch(e){error=e.message;}
  finally{booting=false;if(!name&&!room)openSheet('onboarding');else render();probeLatency();}
})();
document.addEventListener('keydown',e=>{
  if(!sheet&&!pendingKick)return;
  if(e.key==='Escape'&&!busy)closeSheet();
  else if(e.key==='Tab'){const items=[...root.querySelectorAll('[role=dialog] button:not(:disabled),[role=dialog] input:not(:disabled),[role=dialog] select:not(:disabled)')];if(items.length){e.preventDefault();const i=items.indexOf(document.activeElement);items[(i+(e.shiftKey?-1:1)+items.length)%items.length].focus();}}
});
