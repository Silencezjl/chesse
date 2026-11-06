export function mount(platform) {
const root = platform.element, ui = platform.root;
const roomId = platform.roomId, playerId = platform.playerId;
const abort = new AbortController();
const timers = new Set();
const setInterval = (fn,ms) => { const id=window.setInterval(fn,ms);timers.add(id);return id; };
const setTimeout = (fn,ms) => { const id=window.setTimeout(fn,ms);timers.add(id);return id; };
const listen = (target,event,fn) => target.addEventListener(event,fn,{signal:abort.signal});

const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const roleName = {judge:'大聪明',honest:'老实人',bluffer:'瞎掰人'};
const roleCards = {judge:'/bluff/assets/role-judge-v1.webp',honest:'/bluff/assets/role-honest-v1.webp',bluffer:'/bluff/assets/role-bluffer-v1.webp'};
Object.values(roleCards).forEach(src=>{const image=new Image();image.src=src;});
const phaseName = {choose:'选题',prepare:'确认准备',viewing:'限时看答案',discussion:'线下讨论与指认',reveal:'本轮揭晓',finished:'游戏结束'};
let connected=false, sending=false, pendingTarget=null, privateAllowed=true, reconnectTimer=null, selectedDifficulty=null;
const footerObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(entries=>{root.style.setProperty('--bluff-actions-height', `${entries[0].target.offsetHeight}px`);}) : {observe(){},disconnect(){}};
let socket, state=null, error='', showRole=false, viewedRole=false, roleKey=null, holdingPointer=null, holdingKey=false, clockStart=0, clockValue=0;
function rememberRole(){viewedRole=true;try{sessionStorage.setItem(roleKey,'1')}catch{}}
function hideRole(){if(showRole || holdingPointer!==null || holdingKey){showRole=false;holdingPointer=null;holdingKey=false;render();}}
listen(document,'pointerup',e=>{if(e.pointerId===holdingPointer)hideRole();});
listen(document,'pointercancel',e=>{if(e.pointerId===holdingPointer)hideRole();});
listen(window,'blur',hideRole);
function playerName(id){const p=state?.members?.[id];return p ? p.name : id;}
function playerLabel(id){const p=state?.members?.[id];return p ? `${GameAvatars.html(p.avatar)} ${PlayerNames.html(p.name)}` : esc(id);}
function reportConnection(){platform.onConnection(connected);}
function send(type,data={}){
 if(sending)return;
 if(connected&&socket?.readyState===WebSocket.OPEN){sending=true;pendingTarget=null;socket.send(JSON.stringify({type,data}));render();}
 else{error='连接已断开，请稍候';render();}
}
function conceal(){showRole=false;holdingPointer=null;holdingKey=false;privateAllowed=false;pendingTarget=null;render();}
listen(document,'visibilitychange',()=>{if(document.hidden)conceal();else{if(socket?.readyState===WebSocket.OPEN){connected=false;reportConnection();socket.close();}else connect();}});
platform.signal.addEventListener('conceal',conceal,{signal:abort.signal});
function connect(){
 clearTimeout(reconnectTimer);
 if(abort.signal.aborted)return;
 if(socket && [WebSocket.OPEN,WebSocket.CONNECTING].includes(socket.readyState))return;
 if(!roomId || !playerId){ error='缺少房间或玩家信息，请返回大厅。';render();return; }
 socket=new WebSocket(`${location.protocol==='https:'?'wss:':'ws:'}//${location.host}/bluff-ws/${encodeURIComponent(roomId)}/${encodeURIComponent(playerId)}`);
 socket.onmessage=e=>{const msg=JSON.parse(e.data); if(msg.type==='error'){sending=false;error=msg.message;render();return} if(msg.type==='state'){
   const nextRoleKey=`bluff-role:${roomId}:${msg.data.session_id || 'legacy'}:${playerId}:${msg.data.round}`;
   if(roleKey!==nextRoleKey){roleKey=nextRoleKey;showRole=false;holdingPointer=null;holdingKey=false;try{viewedRole=sessionStorage.getItem(roleKey)==='1'}catch{viewedRole=false;}}
   if(state?.phase!==msg.data.phase){pendingTarget=null;selectedDifficulty=null;if(msg.data.phase==='viewing')privateAllowed=!document.hidden;}
   state=msg.data;connected=true;sending=false;reportConnection();error='';clockStart=performance.now();clockValue=state.remaining || 0;render();
 }};
 socket.onclose=e=>{connected=false;sending=false;pendingTarget=null;reportConnection();error=[4001,4403,4404,1000].includes(e.code)?'本页连接已结束，请返回房间。':'连接已断开，正在重连…';render();if(![4001,4403,4404,1000].includes(e.code))reconnectTimer=setTimeout(connect,1500)};
}
function scoreboard(){return `<div class="grid">${state.players.map(p=>`<div class="score">${playerLabel(p)}${p===state.judge?' · 大聪明':''}<br><strong>${state.scores[p]} 分</strong></div>`).join('')}</div>`}
function questionCard(){if(!state.question)return '';return `<section class="card hero"><span class="muted">本轮题目 · ${state.question.difficulty} 分</span><h2>${esc(state.question.title)}</h2><div>${state.question.hints.length ? `提示：${state.question.hints.map(esc).join(' / ')}` : '本题没有提示'}</div></section>`}
function buttonsForTargets(type){return `<div class="grid">${state.players.filter(p=>p!==state.judge).map(p=>`<button class="secondary target" data-action="${type}" data-id="${esc(p)}">${playerLabel(p)}</button>`).join('')}</div>`}
function history(){return [...(state.history||[])].reverse().map(r=>`<div class="history"><strong>第 ${r.round} 轮：${esc(r.question.title)}</strong><br>答案：${esc(r.question.answer)}<br>大聪明 ${playerLabel(r.judge)} · 老实人 ${playerLabel(r.honest)}<br>质疑 ${playerLabel(r.challenge)} · 指认 ${playerLabel(r.guess)}<br>分数变化：${Object.entries(r.delta).map(([p,d])=>`${playerLabel(p)} ${d>0?'+':''}${d}`).join('，')}<br><a href="${esc(r.question.source)}" target="_blank" rel="noopener noreferrer">题目参考来源</a></div>`).join('<hr>')}
function remaining(){return !state?0:state.paused?clockValue:Math.max(0,clockValue-(performance.now()-clockStart)/1000);}
function roleContent(){
 if(!showRole)return '<p class="muted">请在不被他人看到屏幕时查看。</p>';
 const role=state.my_role;
 const description=role==='judge'?'听取大家的解释，质疑并找出老实人。':role==='honest'?'只有你能在限时阶段查看答案，请如实描述。':'你不知道答案，需要即兴编造并说服大聪明。';
 return `<div class="role-reveal"><div class="role-card role-card-${esc(role)}"><img src="${esc(roleCards[role])}" alt="" width="512" height="768"><p class="role">${esc(roleName[role])}</p></div><p class="role-description">${esc(description)}</p></div>`;
}
function revealRole(){showRole=true;rememberRole();ui.getElementById('role-content').innerHTML=roleContent();}
function render(){
 if(showRole && (holdingPointer!==null || holdingKey))return;
 if(!state){root.innerHTML=`<section class="card"><div class="row"><img src="/assets/game-bluff-indigo-v1.webp" alt="" width="56" height="56"><h1>瞎掰王</h1></div><p class="muted">${esc(error||'正在连接房间…')}</p></section>`;return}
 const judge=state.judge===playerId, owner=state.owner_id===playerId, participant=Boolean(state.my_role);
 const openDetails=[...root.querySelectorAll('details[id][open]')].map(d=>d.id);
 const focused=ui.activeElement?.id;
 let content=`<header class="row between"><div><p class="muted">第 ${state.round}/${state.total_rounds} 轮 ${judge?'<span class="judge-tag">你是大聪明</span>':''} · 大聪明：${playerLabel(state.judge)}</p></div><div class="round-actions"><span class="pill">${esc(phaseName[state.phase]||state.phase)}</span>${owner&&state.phase!=='finished'?'<button class="end-game" id="terminate">结束本局</button>':''}</div></header>`;
 if(error)content+=`<div class="error">${esc(error)}</div>`;
 if(state.paused && state.phase!=='finished')content+='<div class="warn">有参与玩家离线，游戏已暂停。等待重连后继续；房主可结束本局。</div>';
 if(participant && state.phase!=='finished')content+=`<div id="role-content">${roleContent()}</div>`;
 if(!participant)content+='<div class="card muted">你是观众。揭晓前不会显示身份和答案。</div>';
 content+=questionCard();
 if(state.phase==='choose')content+=judge?`<section class="question-picker"><div class="picker-heading"><h1>选择题目</h1><p class="muted">打开题库查看谜面，选一道题给大家讨论。</p></div><div class="bank-tabs" role="group" aria-label="题目分值">${[1,2,3].map(n=>`<button class="bank-tab ${selectedDifficulty===n?'active':''}" data-bank="${n}" aria-pressed="${selectedDifficulty===n}" ${!state.available[n]?'disabled':''}><strong>${n} 分</strong><small>剩 ${state.available[n]} 题</small></button>`).join('')}</div>${selectedDifficulty?`<div class="picker-list"><div class="picker-list-head"><div><h2>${selectedDifficulty} 分题库</h2><p class="muted">${selectedDifficulty===1?'一个提示':selectedDifficulty===2?'三个方向中一个正确':'没有提示'} · 选择谜面后开始本轮</p></div><button class="secondary draw" data-value="${selectedDifficulty}" ${state.paused?'disabled':''}>随机选题</button></div>${(state.question_bank||[]).filter(q=>q.difficulty===selectedDifficulty).map(q=>`<button class="question-option" data-question="${esc(q.id)}" ${state.paused?'disabled':''}><span><strong>${esc(q.title)}</strong><small>${q.hints.length?`提示：${q.hints.map(esc).join(' / ')}`:'没有提示'}</small></span><span aria-hidden="true">›</span></button>`).join('')}</div>`:'<div class="picker-empty">选择上方题库，浏览全部可选谜面。</div>'}${Object.values(state.available).every(v=>v===0)?'<p class="warn">题库已用完，房主可以结束本局。</p>':''}</section>`:`<section class="card"><h2>等待大聪明选题</h2><p class="muted">大聪明正在题库中挑选本轮谜面。</p></section>`;
 if(state.phase==='prepare')content+=`<section class="card"><h2>准备查看答案</h2><p class="muted">已准备 ${state.ready_count}/${state.players.length}。所有参与者准备后开始 9 秒查看。</p>${judge?`<button class="secondary" id="skip" ${state.paused?'disabled':''}>换一道题</button>`:''}${participant&&!viewedRole&&!state.i_ready?'<p class="muted">请先查看身份牌。</p>':''}</section>`;
 if(state.phase==='viewing')content+=`<section class="card"><h2>限时查看答案</h2><p class="muted">其余玩家请勿偷看别人的屏幕。</p><div class="big" id="countdown">${Math.ceil(remaining())} 秒</div>${state.answer&&privateAllowed&&!document.hidden&&remaining()>0?`<div class="answer" id="answer"><strong>仅你可见的答案</strong><p>${esc(state.answer)}</p></div>`:'<p class="muted">请等待查看时间结束。</p>'}</section>`;
 if(state.phase==='discussion')content+=`<section class="card"><h2>放下手机，面对面讨论</h2><p class="muted">请面对面发言和提问。大聪明必须先质疑一人，再指认老实人。</p>${judge?(!state.challenge_made?`<strong>请选择质疑对象</strong>${buttonsForTargets('challenge')}`:`<p>已质疑 ${playerLabel(state.my_challenge)}</p><strong>请选择你认为的老实人</strong>${buttonsForTargets('guess')}`):`<p class="muted">${state.challenge_made?'大聪明正在指认老实人。':'等待大聪明选择质疑对象。'}</p>`}</section>`;
 if(state.phase==='reveal')content+=`<section class="card"><h2>本轮揭晓</h2>${history()}${playerId===state.judge||owner?'':'<p class="muted">等待大聪明或房主进入下一轮。</p>'}</section>`;
 if(state.phase==='finished')content+=`<section class="card"><h2>${state.terminated?'本局已提前结束':'🏆 最终结果'}</h2><p>最高分：${state.winners.map(p=>PlayerNames.html(playerName(p))).join('、')}</p>${scoreboard()}<p class="muted">请返回公共房间切换游戏。</p></section>${state.history?.length?`<section class="card"><h2>已完成回合</h2>${history()}</section>`:''}`;
 if(state.phase!=='finished' && !(state.phase==='choose' && judge))content+=`<details class="card" id="scores"><summary>查看当前分数</summary>${scoreboard()}</details>`;
 if(state.phase!=='finished' && (participant || (state.phase==='reveal' && owner)))content+=`<div class="game-actions">${participant?'<button class="secondary" id="role-toggle">按住查看身份</button>':''}${state.phase==='prepare'&&participant?`<button id="ready" ${state.paused||state.i_ready||!viewedRole?'disabled':''}>${state.i_ready?'已准备':'确认准备'}</button>`:''}${state.phase==='reveal'&&(judge||owner)?`<button id="next" ${state.paused?'disabled':''}>${state.round===state.total_rounds?'查看最终结果':'下一轮'}</button>`:''}</div>`;
 if(pendingTarget)content+=`<div class="modal-backdrop"><section class="confirm-card" role="dialog" aria-modal="true" aria-label="确认操作"><h2>${pendingTarget.action==='terminate'?'提前结束本局？':pendingTarget.action==='challenge'?'确认质疑这位玩家？':'确认指认这位玩家为老实人？'}</h2><p>${pendingTarget.action==='terminate'?'未完成回合不会计分，已完成结果保留。':PlayerNames.html(playerName(pendingTarget.id))}</p><button id="confirm-target">确认提交</button><button class="secondary" id="cancel-target">重新选择</button></section></div>`;
 footerObserver.disconnect();
 root.innerHTML=content;
 const footer=root.querySelector('.game-actions');
 if(footer){footerObserver.observe(footer);root.style.setProperty('--bluff-actions-height', `${footer.offsetHeight}px`);}else root.style.removeProperty('--bluff-actions-height');
 if(pendingTarget)[...root.children].forEach(el=>{if(!el.classList.contains('modal-backdrop'))el.inert=true;});
 openDetails.forEach(id=>{const el=ui.getElementById(id);if(el)el.open=true;});
 if(focused)ui.getElementById(focused)?.focus({preventScroll:true});
 if(sending||!connected)root.querySelectorAll('button:not(#role-toggle)').forEach(b=>b.disabled=true);

 const confirmButton=ui.getElementById('confirm-target');if(confirmButton&&state.paused&&pendingTarget?.action!=='terminate')confirmButton.disabled=true;
 const bind=(id,fn)=>{let el=ui.getElementById(id);if(el)el.onclick=fn};
 const roleButton=ui.getElementById('role-toggle');
 if(roleButton){
  roleButton.oncontextmenu=e=>e.preventDefault();
  // Pointer cancellation from a native long-press gesture would hide the card.
  // Prevent that gesture at its touch source; actual cancellation still conceals it.
  roleButton.addEventListener('touchstart',e=>e.preventDefault(),{passive:false});
  roleButton.addEventListener('touchmove',e=>e.preventDefault(),{passive:false});
  roleButton.onpointerdown=e=>{if(e.button!==0 || holdingPointer!==null)return;e.preventDefault();holdingPointer=e.pointerId;try{roleButton.setPointerCapture(e.pointerId)}catch{}revealRole();};
  roleButton.onkeydown=e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();if(!e.repeat){holdingKey=true;revealRole();}}};
 }
 bind('ready',()=>send('ready'));bind('skip',()=>send('skip'));bind('next',()=>send('next'));
 bind('terminate',()=>{pendingTarget={action:'terminate'};render()});
 bind('cancel-target',()=>{pendingTarget=null;render()});bind('confirm-target',()=>{const target=pendingTarget;if(target)send(target.action,target.id?{target_id:target.id}:{});});
 root.querySelectorAll('.bank-tab').forEach(b=>b.onclick=()=>{selectedDifficulty=Number(b.dataset.bank);render()});
 root.querySelectorAll('.question-option').forEach(b=>b.onclick=()=>send('select',{question_id:b.dataset.question}));
 root.querySelectorAll('.draw').forEach(b=>b.onclick=()=>send('draw',{difficulty:Number(b.dataset.value)}));
 root.querySelectorAll('.target').forEach(b=>{b.disabled=state.paused||sending||!connected;b.onclick=()=>{pendingTarget={action:b.dataset.action,id:b.dataset.id};render()}});
}
setInterval(()=>{if(!state || state.phase!=='viewing')return;const n=state.paused?clockValue:Math.max(0,clockValue-(performance.now()-clockStart)/1000);const c=ui.getElementById('countdown');if(c)c.textContent=`${Math.ceil(n)} 秒`;if(n<=0){const a=ui.getElementById('answer');if(a)a.remove();}},100);
connect();

listen(document,'keydown',e=>{if(!pendingTarget)return;if(e.key==='Escape'){pendingTarget=null;render();}else if(e.key==='Tab'){e.preventDefault();const buttons=[...root.querySelectorAll('[role=dialog] button:not(:disabled)')];if(buttons.length)buttons[(buttons.indexOf(ui.activeElement)+(e.shiftKey?-1:1)+buttons.length)%buttons.length].focus();}});

listen(document,'keyup',e=>{if(holdingKey&&(e.key===' '||e.key==='Enter')){e.preventDefault();hideRole();}});

return () => { abort.abort();footerObserver.disconnect();timers.forEach(id=>{clearInterval(id);clearTimeout(id)});if(socket){socket.onclose=null;socket.onmessage=null;socket.close();} };
}
