const root = document.getElementById('app');
const roomId = new URLSearchParams(location.search).get('room');
const playerId = localStorage.getItem('lobby_player_id');
const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const roleName = {judge:'想想',honest:'老实人',bluffer:'瞎掰人'};
const phaseName = {choose:'选题',prepare:'确认准备',viewing:'限时看答案',discussion:'线下讨论与指认',reveal:'本轮揭晓',finished:'游戏结束'};
let connected=false, sending=false, pendingTarget=null, privateAllowed=true, reconnectTimer=null;
let socket, state=null, error='', showRole=false, lastRound=null, clockStart=0, clockValue=0;
function playerName(id){const p=state?.members?.[id];return p ? p.name : id;}
function playerLabel(id){const p=state?.members?.[id];return p ? `${GameAvatars.html(p.avatar)} ${PlayerNames.html(p.name)}` : esc(id);}
function reportConnection(){if(window.parent!==window)window.parent.postMessage({type:'game_connection',connected},location.origin);}
function send(type,data={}){
 if(sending)return;
 if(connected&&socket?.readyState===WebSocket.OPEN){sending=true;pendingTarget=null;socket.send(JSON.stringify({type,data}));render();}
 else{error='连接已断开，请稍候';render();}
}
function conceal(){showRole=false;privateAllowed=false;pendingTarget=null;render();}
document.addEventListener('visibilitychange',()=>{if(document.hidden)conceal();else{if(socket?.readyState===WebSocket.OPEN){connected=false;reportConnection();socket.close();}else connect();}});
window.addEventListener('message',e=>{if(e.origin===location.origin&&e.source===window.parent&&e.data?.type==='conceal_private')conceal();});
function connect(){
 clearTimeout(reconnectTimer);
 if(socket && [WebSocket.OPEN,WebSocket.CONNECTING].includes(socket.readyState))return;
 if(!roomId || !playerId){ error='缺少房间或玩家信息，请返回大厅。';render();return; }
 socket=new WebSocket(`${location.protocol==='https:'?'wss:':'ws:'}//${location.host}/bluff-ws/${encodeURIComponent(roomId)}/${encodeURIComponent(playerId)}`);
 socket.onmessage=e=>{const msg=JSON.parse(e.data); if(msg.type==='error'){sending=false;error=msg.message;render();return} if(msg.type==='state'){
   if(lastRound!==msg.data.round){showRole=false;lastRound=msg.data.round;}
   if(state?.phase!==msg.data.phase){pendingTarget=null;if(msg.data.phase==='viewing')privateAllowed=!document.hidden;}
   state=msg.data;connected=true;sending=false;reportConnection();error='';clockStart=performance.now();clockValue=state.remaining || 0;render();
 }};
 socket.onclose=e=>{connected=false;sending=false;pendingTarget=null;reportConnection();error=[4001,4403,4404,1000].includes(e.code)?'本页连接已结束，请返回房间。':'连接已断开，正在重连…';render();if(![4001,4403,4404,1000].includes(e.code))reconnectTimer=setTimeout(connect,1500)};
}
function scoreboard(){return `<div class="grid">${state.players.map(p=>`<div class="score">${playerLabel(p)}${p===state.judge?' · 想想':''}<br><strong>${state.scores[p]} 分</strong></div>`).join('')}</div>`}
function questionCard(){if(!state.question)return '';return `<section class="card hero"><span class="muted">本轮题目 · ${state.question.difficulty} 分</span><h2>${esc(state.question.title)}</h2><div>${state.question.hints.length ? `提示：${state.question.hints.map(esc).join(' / ')}` : '本题没有提示'}</div></section>`}
function buttonsForTargets(type){return `<div class="grid">${state.players.filter(p=>p!==state.judge).map(p=>`<button class="secondary target" data-action="${type}" data-id="${esc(p)}">${playerLabel(p)}</button>`).join('')}</div>`}
function history(){return [...(state.history||[])].reverse().map(r=>`<div class="history"><strong>第 ${r.round} 轮：${esc(r.question.title)}</strong><br>答案：${esc(r.question.answer)}<br>想想 ${playerLabel(r.judge)} · 老实人 ${playerLabel(r.honest)}<br>质疑 ${playerLabel(r.challenge)} · 指认 ${playerLabel(r.guess)}<br>分数变化：${Object.entries(r.delta).map(([p,d])=>`${playerLabel(p)} ${d>0?'+':''}${d}`).join('，')}<br><a href="${esc(r.question.source)}" target="_blank" rel="noopener noreferrer">题目参考来源</a></div>`).join('<hr>')}
function remaining(){return !state?0:state.paused?clockValue:Math.max(0,clockValue-(performance.now()-clockStart)/1000);}
function render(){
 if(!state){root.innerHTML=`<section class="card"><div class="row"><img src="/assets/game-bluff-indigo-v1.webp" alt="" width="56" height="56"><h1>瞎掰王</h1></div><p class="muted">${esc(error||'正在连接房间…')}</p></section>`;return}
 const judge=state.judge===playerId, owner=state.owner_id===playerId, participant=Boolean(state.my_role);
 const openDetails=[...root.querySelectorAll('details[id][open]')].map(d=>d.id);
 const focused=document.activeElement?.id;
 let content=`<header class="row between"><div><p class="muted">第 ${state.round}/${state.total_rounds} 轮 · 想想：${playerLabel(state.judge)}</p></div><span class="pill">${esc(phaseName[state.phase]||state.phase)}</span></header>`;
 if(error)content+=`<div class="error">${esc(error)}</div>`;
 if(state.paused && state.phase!=='finished')content+='<div class="warn">有参与玩家离线，游戏已暂停。等待重连后继续；房主可结束本局。</div>';
 if(participant && state.phase!=='finished')content+=`<section class="card"><div class="row between"><span>你的身份</span><button class="secondary" id="role-toggle">${showRole?'隐藏身份':'查看身份牌'}</button></div>${showRole?`<p class="role">${esc(roleName[state.my_role])}</p><p class="muted">${state.my_role==='judge'?'听取大家的解释，质疑并找出老实人。':state.my_role==='honest'?'只有你能在限时阶段查看答案，请如实描述。':'你不知道答案，需要即兴编造并说服想想。'}</p>`:'<p class="muted">请在不被他人看到屏幕时查看。</p>'}</section>`;
 if(!participant)content+='<div class="card muted">你是观众。揭晓前不会显示身份和答案。</div>';
 content+=questionCard();
 if(state.phase==='choose')content+=`<section class="card"><h2>选择题目难度</h2>${judge?`<p class="muted">1 分：一个提示；2 分：三个方向中一个正确；3 分：没有提示。</p><div class="row">${[1,2,3].map(n=>`<button class="draw" data-value="${n}" ${state.paused||!state.available[n]?'disabled':''}>${n} 分 · 剩 ${state.available[n]} 题</button>`).join('')}</div>`:`<p class="muted">等待想想选题。</p>`}${Object.values(state.available).every(v=>v===0)?'<p class="warn">题库已用完，房主可以结束本局。</p>':''}</section>`;
 if(state.phase==='prepare')content+=`<section class="card"><h2>准备查看答案</h2><p class="muted">已准备 ${state.ready_count}/${state.players.length}。所有参与者准备后开始 9 秒查看。</p><div class="row">${participant?`<button id="ready" ${state.paused||state.i_ready||!showRole?'disabled':''}>${state.i_ready?'已准备':'确认准备'}</button>`:''}${judge?`<button class="secondary" id="skip" ${state.paused?'disabled':''}>换一道题</button>`:''}</div>${participant&&!showRole&&!state.i_ready?'<p class="muted">请先查看身份牌。</p>':''}</section>`;
 if(state.phase==='viewing')content+=`<section class="card"><h2>限时查看答案</h2><p class="muted">其余玩家请勿偷看别人的屏幕。</p><div class="big" id="countdown">${Math.ceil(remaining())} 秒</div>${state.answer&&privateAllowed&&!document.hidden&&remaining()>0?`<div class="answer" id="answer"><strong>仅你可见的答案</strong><p>${esc(state.answer)}</p></div>`:'<p class="muted">请等待查看时间结束。</p>'}</section>`;
 if(state.phase==='discussion')content+=`<section class="card"><h2>放下手机，面对面讨论</h2><p class="muted">请面对面发言和提问。想想必须先质疑一人，再指认老实人。</p>${judge?(!state.challenge_made?`<strong>请选择质疑对象</strong>${buttonsForTargets('challenge')}`:`<p>已质疑 ${playerLabel(state.my_challenge)}</p><strong>请选择你认为的老实人</strong>${buttonsForTargets('guess')}`):`<p class="muted">${state.challenge_made?'想想正在指认老实人。':'等待想想选择质疑对象。'}</p>`}</section>`;
 if(state.phase==='reveal')content+=`<section class="card"><h2>本轮揭晓</h2>${history()}${playerId===state.judge||owner?`<button id="next" ${state.paused?'disabled':''}>${state.round===state.total_rounds?'查看最终结果':'下一轮'}</button>`:'<p class="muted">等待想想或房主进入下一轮。</p>'}</section>`;
 if(state.phase==='finished')content+=`<section class="card"><h2>${state.terminated?'本局已提前结束':'🏆 最终结果'}</h2><p>最高分：${state.winners.map(p=>PlayerNames.html(playerName(p))).join('、')}</p>${scoreboard()}<p class="muted">请返回公共房间切换游戏。</p></section>${state.history?.length?`<section class="card"><h2>已完成回合</h2>${history()}</section>`:''}`;
 if(state.phase!=='finished')content+=`<details class="card" id="scores"><summary>查看当前分数与管理</summary>${scoreboard()}${owner?'<button class="danger" id="terminate">提前结束本局</button>':''}</details>`;
 if(pendingTarget)content+=`<div class="modal-backdrop"><section class="confirm-card" role="dialog" aria-modal="true" aria-label="确认操作"><h2>${pendingTarget.action==='terminate'?'提前结束本局？':pendingTarget.action==='challenge'?'确认质疑这位玩家？':'确认指认这位玩家为老实人？'}</h2><p>${pendingTarget.action==='terminate'?'未完成回合不会计分，已完成结果保留。':PlayerNames.html(playerName(pendingTarget.id))}</p><button id="confirm-target">确认提交</button><button class="secondary" id="cancel-target">重新选择</button></section></div>`;
 root.innerHTML=content;
 if(pendingTarget)[...root.children].forEach(el=>{if(!el.classList.contains('modal-backdrop'))el.inert=true;});
 openDetails.forEach(id=>{const el=document.getElementById(id);if(el)el.open=true;});
 if(focused)document.getElementById(focused)?.focus({preventScroll:true});
 if(sending||!connected)root.querySelectorAll('button:not(#role-toggle)').forEach(b=>b.disabled=true);

 const confirmButton=document.getElementById('confirm-target');if(confirmButton&&state.paused&&pendingTarget?.action!=='terminate')confirmButton.disabled=true;
 const bind=(id,fn)=>{let el=document.getElementById(id);if(el)el.onclick=fn};
 bind('role-toggle',()=>{showRole=!showRole;privateAllowed=showRole;render()});bind('ready',()=>send('ready'));bind('skip',()=>send('skip'));bind('next',()=>send('next'));
 bind('terminate',()=>{pendingTarget={action:'terminate'};render()});
 bind('cancel-target',()=>{pendingTarget=null;render()});bind('confirm-target',()=>{const target=pendingTarget;if(target)send(target.action,target.id?{target_id:target.id}:{});});
 root.querySelectorAll('.draw').forEach(b=>b.onclick=()=>send('draw',{difficulty:Number(b.dataset.value)}));
 root.querySelectorAll('.target').forEach(b=>{b.disabled=state.paused||sending||!connected;b.onclick=()=>{pendingTarget={action:b.dataset.action,id:b.dataset.id};render()}});
}
setInterval(()=>{if(!state || state.phase!=='viewing')return;const n=state.paused?clockValue:Math.max(0,clockValue-(performance.now()-clockStart)/1000);const c=document.getElementById('countdown');if(c)c.textContent=`${Math.ceil(n)} 秒`;if(n<=0){const a=document.getElementById('answer');if(a)a.remove();}},100);
connect();

document.addEventListener('keydown',e=>{if(!pendingTarget)return;if(e.key==='Escape'){pendingTarget=null;render();}else if(e.key==='Tab'){e.preventDefault();const buttons=[...root.querySelectorAll('[role=dialog] button:not(:disabled)')];if(buttons.length)buttons[(buttons.indexOf(document.activeElement)+(e.shiftKey?-1:1)+buttons.length)%buttons.length].focus();}});
