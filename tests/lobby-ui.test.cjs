const {test} = require('node:test');
const assert = require('node:assert/strict');
const {JSDOM} = require('jsdom');
const fs = require('node:fs');
const source = fs.readFileSync('lobby-web/lobby.js','utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const initial = () => ({id:'123456',owner_id:'p0',game_id:'cheese',options:{max_dice:6},stage:'waiting',seats:['p0','p1'],revision:1,session_id:null,session_members:[],server_time:Date.now()/1000,members:{p0:{name:'房主',avatar:'🐭',connected:true,ready:false},p1:{name:'朋友',avatar:'🦊',connected:true,ready:false}}});
const tick = () => new Promise(resolve=>setImmediate(resolve));
async function app(start=initial(), directory=[], savedName='房主') {
  let room=clone(start),clock=1000;const calls=[],sockets=[],intervals=[];
  const dom=new JSDOM('<div id="app"></div><section id="game-shell" hidden></section><div id="toast"></div>',{url:'http://example.test/',runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window;Object.defineProperty(w.performance,'now',{value:()=>clock});w.localStorage.setItem('lobby_player_id','p0');w.localStorage.setItem('lobby_name',savedName);
  w.setInterval=fn=>{intervals.push(fn);return intervals.length;};
  w.fetch=async(url,opts)=>{
    calls.push({url,body:opts?.body?JSON.parse(opts.body):undefined});
    if(url==='/lobby/ping')return {ok:true,json:async()=>({type:'pong'})};
    if(url==='/lobby/games')return {ok:true,json:async()=>[{id:'cheese',title:'奶酪大盗',icon:'/assets/game-cheese-indigo-v1.webp',minimum:5,maximum:8,entry:'/cheese/',description:'推理',tag:'推理',rules:[{title:'夜晚行动',items:['瞌睡鼠独自醒来可以偷看骰子。']},{title:'胜负判定',items:['投出大盗则瞌睡鼠获胜。']}],settings:[{key:'max_dice',label:'骰子面数',type:'number',min:6,max:10,default:6}]}]};
    if(url==='/lobby/rooms'&&!opts?.body)return {ok:true,json:async()=>clone(directory)};
    if(url==='/lobby/rooms'&&opts?.body){const values=JSON.parse(opts.body);room=initial();room.game_id=values.game_id;room.stage=values.game_id?'waiting':'choosing';room.members.p0.name=values.name;room.members.p0.avatar=values.avatar;room.seats=['p0'];delete room.members.p1;}
    if(url.includes('/players/'))return {ok:true,json:async()=>({room_id:room?.id || null})};
    if(url.endsWith('/preview'))return {ok:true,json:async()=>clone(directory[0])};
    if(url.endsWith('/join')){const values=JSON.parse(opts.body);room={...initial(),id:directory[0].id};room.members.p0.name=values.name;room.members.p0.avatar=values.avatar;}
    if(url.endsWith('/profile')){const values=JSON.parse(opts.body);room.members.p0.name=values.name;room.members.p0.avatar=values.avatar;}
    if(url.includes('manage?action=kick')){const p=JSON.parse(opts.body).target_id;delete room.members[p];room.seats=room.seats.filter(x=>x!==p);room.revision++;}
    if(url.endsWith('/ready')){room.members.p0.ready=JSON.parse(opts.body).ready;}
    return {ok:true,json:async()=>clone(room)};
  };
  class Socket {
    static OPEN=1;
    constructor(){this.sent=[];this.readyState=1;sockets.push(this);queueMicrotask(()=>{this.onopen?.();this.message(room);});}
    send(value){this.sent.push(JSON.parse(value));}
    close(){this.readyState=3;}
    message(data){this.onmessage?.({data:JSON.stringify({type:'room_state',data:clone(data)})});}
  }
  w.WebSocket=Socket;w.eval(fs.readFileSync('lobby-web/player-names.js','utf8'));w.eval(fs.readFileSync('lobby-web/avatars.js','utf8'));w.eval(source);await tick();await tick();
  return {w,dom,calls,sockets,intervals,advance:ms=>clock+=ms,setRoom:r=>{room=clone(r);sockets.at(-1).message(room);}};
}
test('room updates preserve an unfinished settings edit and input focus',async()=>{
  const a=await app();try{
    a.w.document.querySelector('#open-settings').click();
    const input=a.w.document.querySelector('[data-setting=max_dice]');input.focus();input.value='9';input.dispatchEvent(new a.w.Event('input',{bubbles:true}));
    const next=initial();next.members.p1.ready=true;a.setRoom(next);
    const replacement=a.w.document.querySelector('[data-setting=max_dice]');assert.equal(replacement.value,'9');assert.equal(a.w.document.activeElement,replacement);
  }finally{a.dom.window.close();}
});
test('kick uses an accessible in-page confirmation; cancel never calls the API',async()=>{
  const a=await app();try{
    a.w.document.querySelector('[data-member=p1]').click();a.w.document.querySelector('[data-kick=p1]').click();assert.ok(a.w.document.querySelector('[role=dialog][aria-modal=true]'));assert.ok(a.w.document.querySelector('.shell').hasAttribute('inert'));
    a.w.document.querySelector('#cancel-kick').click();assert.equal(a.w.document.querySelector('[role=dialog]'),null);assert.equal(a.calls.filter(c=>c.url.includes('/manage')).length,0);
    a.w.document.querySelector('[data-member=p1]').click();a.w.document.querySelector('[data-kick=p1]').click();a.w.document.querySelector('#confirm-kick').click();await tick();
    assert.equal(a.calls.find(c=>c.url.includes('/manage')).body.target_id,'p1');assert.equal(a.w.document.querySelector('[data-kick=p1]'),null);assert.equal(a.w.document.querySelector('[role=dialog]'),null);
  }finally{a.dom.window.close();}
});
test('readiness requests include an explicit value and configuration revision',async()=>{
  const a=await app();try{
    a.w.document.querySelector('#ready').click();await tick();const call=a.calls.find(c=>c.url.endsWith('/ready'));assert.deepEqual(call.body,{player_id:'p0',ready:true,revision:1});
  }finally{a.dom.window.close();}
});
test('presence updates and viewing the room do not replace the running iframe',async()=>{
  const r=initial();r.stage='playing';r.session_id='session1';r.session_members=['p0','p1'];const a=await app(r);try{
    const frame=a.w.document.querySelector('iframe');assert.ok(frame);a.w.document.querySelector('#show-room').click();assert.equal(a.w.document.querySelector('iframe'),frame);assert.equal(a.w.document.querySelector('#game-shell').hidden,true);
    a.setRoom({...r,members:{...r.members,p1:{...r.members.p1,connected:false}}});assert.equal(a.w.document.querySelector('iframe'),frame);
    a.w.document.querySelector('#resume').click();assert.equal(a.w.document.querySelector('iframe'),frame);assert.equal(a.w.document.querySelector('#game-shell').hidden,false);
  }finally{a.dom.window.close();}
});
test('a new member of a finished room is never sent into the old game',async()=>{
  const r=initial();r.stage='finished';r.session_id='old';r.session_members=['p1'];const a=await app(r);try{assert.equal(a.w.document.querySelector('iframe'),null);assert.ok(a.w.document.querySelector('#next-session'));}finally{a.dom.window.close();}
});
test('directory joins an unlocked room directly using saved device profile',async()=>{
  const a=await app(null,[{id:'222222',owner_name:'小明',owner_avatar:'🐱',game_id:'cheese',stage:'waiting',count:2,capacity:12,joinable:true,has_password:false}]);try{
    assert.match(a.w.document.body.textContent,/小明的房间/);
    assert.equal(a.w.document.querySelector('#join-code'),null);
    a.w.document.querySelector('[data-join]').click();await tick();await tick();
    const call=a.calls.find(c=>c.url.endsWith('/join'));
    assert.equal(call.body.name,'房主');assert.equal(call.body.avatar,'animal-01');
    assert.equal(a.w.document.querySelector('[role=dialog]'),null);
  }finally{a.dom.window.close();}
});
test('password input and focus survive directory refresh',async()=>{
  const a=await app(null,[{id:'222222',owner_name:'小明',owner_avatar:'🐱',stage:'playing',count:2,joinable:true,has_password:true}]);try{
    a.w.document.querySelector('[data-join]').click();await tick();
    const input=a.w.document.querySelector('#password');input.value='secret';input.dispatchEvent(new a.w.Event('input',{bubbles:true}));input.focus();
    await a.intervals[2]();await tick();
    assert.equal(a.w.document.querySelector('#password').value,'secret');assert.equal(a.w.document.activeElement.id,'password');
    assert.equal(a.calls.filter(c=>c.url.endsWith('/join')).length,0);
    a.w.document.querySelector('#room-form').dispatchEvent(new a.w.Event('submit',{bubbles:true,cancelable:true}));await tick();await tick();
    assert.equal(a.calls.find(c=>c.url.endsWith('/join')).body.password,'secret');
  }finally{a.dom.window.close();}
});
test('candidates never mount a game or see a resume action',async()=>{
  const r=initial();r.stage='playing';r.session_id='active';r.session_members=['p1'];r.pending_member_ids=['p0'];r.seats=['p1'];
  const a=await app(r);try{
    assert.equal(a.w.document.querySelector('iframe'),null);assert.equal(a.w.document.querySelector('#resume'),null);
    assert.match(a.w.document.body.textContent,/候场/);
    a.w.document.querySelector('#room-menu').click();assert.equal(a.w.document.querySelector('#leave').disabled,false);
  }finally{a.dom.window.close();}
});
test('editing profile persists only after server success and cancellation keeps old profile',async()=>{
  const a=await app();try{
    a.w.document.querySelector('#my-profile').click();let input=a.w.document.querySelector('#name');input.value='新名字';input.dispatchEvent(new a.w.Event('input',{bubbles:true}));
    a.w.document.querySelector('#close-sheet').click();assert.equal(a.w.localStorage.getItem('lobby_name'),'房主');
    a.w.document.querySelector('#my-profile').click();input=a.w.document.querySelector('#name');input.value='新名字';input.dispatchEvent(new a.w.Event('input',{bubbles:true}));
    a.w.document.querySelector('[data-avatar="animal-30"]').click();
    a.w.document.querySelector('#profile-form').dispatchEvent(new a.w.Event('submit',{bubbles:true,cancelable:true}));await tick();
    assert.equal(a.w.localStorage.getItem('lobby_name'),'新名字');assert.equal(a.w.localStorage.getItem('lobby_avatar'),'animal-30');
  }finally{a.dom.window.close();}
});
test('removal while a room sheet is open closes it without dereferencing a missing room',async()=>{
  const a=await app();try{
    a.w.document.querySelector('#room-menu').click();
    const next=initial();delete next.members.p0;next.owner_id='p1';next.seats=['p1'];a.setRoom(next);await tick();
    assert.equal(a.w.document.querySelector('[role=dialog]'),null);assert.ok(a.w.document.querySelector('#create-room'));
  }finally{a.dom.window.close();}
});
test('a superseded tab conceals its game and pauses reconnection',async()=>{
  const r=initial();r.stage='playing';r.session_id='active';r.session_members=['p0','p1'];
  const a=await app(r);try{
    a.sockets.at(-1).onclose({code:4001});
    assert.equal(a.w.document.querySelector('#game-shell').hidden,true);
    assert.match(a.w.document.body.textContent,/另一个标签页/);
  }finally{a.dom.window.close();}
});
test('header keeps the logo without a wordmark and renders the saved profile as an image',async()=>{
  const a=await app();try{
    const brand=a.w.document.querySelector('#brand');assert.equal(brand.textContent.trim(),'');assert.equal(brand.getAttribute('aria-label'),'游戏大厅');
    const image=a.w.document.querySelector('#my-profile img');assert.equal(image.getAttribute('src'),'/assets/avatars/animals-v1/animal-01.png');
    assert.equal(a.w.document.querySelector('#my-profile').textContent,'房主');
  }finally{a.dom.window.close();}
});
test('avatar URLs stay local for legacy values, supported IDs and untrusted values',async()=>{
  const a=await app();try{
    assert.equal(a.w.GameAvatars.normalize('🦊'),'animal-02');
    assert.equal(a.w.GameAvatars.src('avatar-08'),'/assets/avatars/animals-v1/animal-08.png');
    assert.equal(a.w.GameAvatars.src('https://example.test/track.svg'),'/assets/avatars/animals-v1/animal-01.png');
    assert.equal(a.w.GameAvatars.ids.length,30);
  }finally{a.dom.window.close();}
});
test('animal selection and room refresh preserve picker scroll, dialog scroll and focus',async()=>{
  const a=await app();try{
    a.w.document.querySelector('#my-profile').click();
    const grid=a.w.document.querySelector('.avatars'),dialog=a.w.document.querySelector('[role=dialog]');
    grid.scrollTop=120;dialog.scrollTop=80;
    const choice=a.w.document.querySelector('[data-avatar="animal-30"]');choice.focus();choice.click();
    assert.equal(a.w.document.querySelector('.avatars'),grid);
    assert.equal(grid.scrollTop,120);assert.equal(choice.getAttribute('aria-pressed'),'true');
    assert.equal(grid.textContent.trim(),'');assert.equal(grid.querySelectorAll('[aria-label]').length,30);
    const next=initial();next.members.p1.ready=true;a.setRoom(next);
    assert.equal(a.w.document.querySelector('.avatars').scrollTop,120);
    assert.equal(a.w.document.querySelector('[role=dialog]').scrollTop,80);
    assert.equal(a.w.document.activeElement.id,'pick-animal-30');
    assert.equal(a.w.document.activeElement.getAttribute('aria-pressed'),'true');
  }finally{a.dom.window.close();}
});
test('random nicknames offer 100 distinct names without saving until submission',async()=>{
  const a=await app();try{
    a.w.document.querySelector('#my-profile').click();const names=new Set();
    for(let i=0;i<100;i++){
      let call=0;a.w.Math.random=()=>call++%2===0?(i+.1)/100:0;
      a.w.document.querySelector('#random-name').click();
      const value=a.w.document.querySelector('#name').value;
      assert.doesNotMatch(value, /#|[0-9]/);assert.ok(value);assert.ok(value.length<=12);names.add(value);
    }
    assert.equal(names.size,100);assert.equal(a.w.localStorage.getItem('lobby_name'),'房主');
    assert.equal(a.calls.filter(c=>c.url.endsWith('/profile')).length,0);
    const base=a.w.document.querySelector('#name').value,draft=base;a.setRoom(initial());
    assert.equal(a.w.document.querySelector('#name').value,base);
    a.w.document.querySelector('#profile-form').dispatchEvent(new a.w.Event('submit',{bubbles:true,cancelable:true}));await tick();
    assert.equal(a.w.localStorage.getItem('lobby_name'),draft);
    assert.equal(a.calls.find(c=>c.url.endsWith('/profile')).body.name,draft);
  }finally{a.dom.window.close();}
});
test('names have no suffix, legacy names remain compatible, and input preserves the full name',async()=>{
  const r=initial();r.members.p0.name='摸鱼小熊07';r.members.p1.name='朋友#42';const a=await app(r);try{
    assert.equal(a.w.PlayerNames.text('摸鱼小熊07'),'摸鱼小熊');
    assert.equal(a.w.PlayerNames.text('自定义2026'),'自定义2026');
    assert.equal(a.w.PlayerNames.html('<img src=x onerror=alert(1)>#09'),'&lt;img src=x onerror=alert(1)&gt;');
    assert.equal(a.w.PlayerNames.html('用户#123'),'用户#123');
    assert.equal(a.w.document.querySelector('#my-profile').textContent,'摸鱼小熊');
    assert.equal(a.w.document.querySelector('[data-member=p1] strong').textContent,'朋友');
    a.w.document.querySelector('#my-profile').click();
    assert.equal(a.w.document.querySelector('#name').value,'摸鱼小熊');assert.equal(a.w.document.querySelector('#name').maxLength,12);
    const input=a.w.document.querySelector('#name');input.value='新昵称';input.dispatchEvent(new a.w.Event('input',{bubbles:true}));
    a.w.document.querySelector('#profile-form').dispatchEvent(new a.w.Event('submit',{bubbles:true,cancelable:true}));await tick();
    assert.equal(a.w.localStorage.getItem('lobby_name'),'新昵称');
  }finally{a.dom.window.close();}
});
test('random names avoid occupied legacy variants and do not repeat before the pool is exhausted',async()=>{
 const a=await app();try{
  const names=a.w.PlayerNames,seen=new Set();a.w.Math.random=()=>0;
  for(let i=0;i<99;i++){const next=names.random('', ['摸鱼小熊#07']);assert.notEqual(next,'摸鱼小熊');assert.ok(!seen.has(next));seen.add(next);}
  assert.equal(seen.size,99);assert.notEqual(names.random('', ['摸鱼小熊07']),'摸鱼小熊');
  const expanded=names.random('',names.pool);assert.doesNotMatch(expanded,/[0-9#]/);assert.ok(!names.pool.includes(expanded));
  assert.deepEqual([...names.pool],JSON.parse(fs.readFileSync('backend/lobby/nicknames.json','utf8')));
 }finally{a.dom.window.close();}
});

test('joining with an occupied name automatically retries without a profile form',async()=>{
 const r={id:'654321',owner_name:'朋友',owner_avatar:'animal-01',game_id:'cheese',stage:'waiting',count:1,capacity:12,joinable:true,has_password:false};
 const a=await app(null,[r]);try{
  const original=a.w.fetch;let blocked=true;
  a.w.fetch=async(url,opts)=>{if(url.endsWith('/join')&&blocked){blocked=false;return {ok:false,json:async()=>({detail:{code:'nickname_taken',message:'昵称重名'}})};}return original(url,opts);};
  a.w.document.querySelector('[data-join]').click();await tick();await tick();
  assert.equal(a.w.document.querySelector('#name'),null);assert.notEqual(a.w.localStorage.getItem('lobby_name'),'房主');assert.notEqual(a.w.localStorage.getItem('lobby_name'),'朋友');
  assert.equal(a.w.localStorage.getItem('lobby_player_id'),'p0');assert.equal(a.w.document.querySelector('[role=dialog]'),null);
  assert.match(a.w.document.querySelector('#toast').textContent,/重名/);
 }finally{a.dom.window.close();}
});
test('first visit requires a name or a random choice and cannot dismiss onboarding',async()=>{
 const a=await app(null,[],'');try{
  assert.equal(a.w.document.querySelector('#sheet-title').textContent,'先取个昵称吧');
  assert.equal(a.w.document.querySelector('#name').value,'');assert.equal(a.w.document.querySelector('#save-profile').disabled,true);
  assert.equal(a.w.document.querySelector('#close-sheet'),null);
  a.w.document.dispatchEvent(new a.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.ok(a.w.document.querySelector('[role=dialog]'));
  a.w.document.querySelector('#create-room').click();assert.equal(a.w.document.querySelector('#room-form'),null);
  a.w.document.querySelector('#random-name').click();const name=a.w.document.querySelector('#name').value;assert.ok(name);assert.equal(a.w.document.querySelector('#save-profile').disabled,false);
  a.w.document.querySelector('#profile-form').dispatchEvent(new a.w.Event('submit',{bubbles:true,cancelable:true}));await tick();
  assert.equal(a.w.localStorage.getItem('lobby_name'),name);assert.equal(a.w.document.querySelector('[role=dialog]'),null);
 }finally{a.dom.window.close();}
});
test('one click creates an unlocked room without a form and password settings stay inside the room',async()=>{
 const a=await app(null,[]);try{
  a.w.document.querySelector('#create-room').click();a.w.document.querySelector('#create-room').click();await tick();await tick();
  const requests=a.calls.filter(c=>c.url==='/lobby/rooms'&&c.body);assert.equal(requests.length,1);
  assert.equal(requests[0].body.name,'房主');assert.equal(requests[0].body.game_id,null);assert.equal(requests[0].body.password,undefined);
  assert.equal(a.w.document.querySelector('#room-form'),null);assert.equal(a.w.document.querySelector('#name'),null);assert.equal(a.w.document.querySelector('#password'),null);
  a.w.document.querySelector('#room-menu').click();a.w.document.querySelector('#edit-password').click();assert.ok(a.w.document.querySelector('#password-form'));assert.ok(a.w.document.querySelector('#password'));
 }finally{a.dom.window.close();}
});
test('waiting room shows full selected-game rules inline and keeps them in the rules dialog',async()=>{
 const a=await app();try{
  const text=a.w.document.querySelector('.waiting-rules').textContent;assert.match(text,/奶酪大盗.*游戏规则/);assert.match(text,/夜晚行动/);assert.match(text,/偷看骰子/);assert.match(text,/胜负判定/);assert.match(text,/骰子面数 6/);
  a.w.document.querySelector('#open-rules').click();assert.match(a.w.document.querySelector('[role=dialog]').textContent,/偷看骰子/);
 }finally{a.dom.window.close();}
});
test('restoring an existing room recovers its profile without showing first-visit onboarding',async()=>{
 const a=await app(initial(),[],'');try{
  assert.equal(a.w.localStorage.getItem('lobby_name'),'房主');assert.ok(a.w.document.querySelector('#ready'));assert.equal(a.w.document.querySelector('[role=dialog]'),null);
 }finally{a.dom.window.close();}
});

test('room ping correlates replies, updates in place and clears stale samples after timeout or disconnect',async()=>{
 const a=await app();try{
  const socket=a.sockets.at(-1),ping=()=>socket.sent.filter(m=>m.type==='ping').at(-1),reply=id=>socket.onmessage({data:JSON.stringify({type:'pong',id})});
  assert.match(a.w.document.querySelector('.latency-label').textContent,/测量中/);
  const first=ping();a.advance(37);reply(first.id);assert.equal(a.w.document.querySelector('.latency-label').textContent,'延迟 37ms');
  a.w.document.querySelector('#my-profile').click();const input=a.w.document.querySelector('#name'),grid=a.w.document.querySelector('.avatars');input.value='未保存草稿';input.dispatchEvent(new a.w.Event('input',{bubbles:true}));input.focus();grid.scrollTop=120;
  await a.intervals.find(fn=>fn.name==='probeLatency')();const second=ping();a.advance(280);reply(first.id);assert.equal(a.w.document.querySelector('.latency-label').textContent,'延迟 37ms');reply(second.id);
  assert.equal(a.w.document.querySelector('.latency-label').textContent,'延迟 280ms');assert.equal(a.w.document.querySelector('.latency-badge').dataset.level,'fair');
  assert.equal(a.w.document.querySelector('#name'),input);assert.equal(input.value,'未保存草稿');assert.equal(a.w.document.activeElement,input);assert.equal(grid.scrollTop,120);
  await a.intervals.find(fn=>fn.name==='probeLatency')();a.advance(10001);await a.intervals.find(fn=>fn.name==='probeLatency')();assert.match(a.w.document.querySelector('.latency-label').textContent,/超时/);reply(second.id);assert.match(a.w.document.querySelector('.latency-label').textContent,/超时/);
  const current=ping();a.advance(12);reply(current.id);assert.equal(a.w.document.querySelector('.latency-label').textContent,'延迟 12ms');
  socket.onclose({code:4001});reply(current.id);assert.match(a.w.document.querySelector('.latency-label').textContent,/未连接/);
 }finally{a.dom.window.close();}
});
test('HTTP ping measures a server response and late HTTP replies cannot replace room ping',async()=>{
 const a=await app(null);try{
  assert.equal(a.w.document.querySelector('.latency-label').textContent,'延迟 1ms');
  const original=a.w.fetch;let finish;
  a.w.fetch=(url,opts)=>url==='/lobby/ping'?new Promise(resolve=>finish=resolve):original(url,opts);
  const probe=a.intervals.find(fn=>fn.name==='probeLatency'),pending=probe();a.advance(125);finish({ok:true,json:async()=>({type:'pong'})});await pending;
  assert.equal(a.w.document.querySelector('.latency-label').textContent,'延迟 125ms');
  const stale=probe();a.w.document.querySelector('#create-room').click();await tick();await tick();
  const socket=a.sockets.at(-1),id=socket.sent.find(m=>m.type==='ping').id;a.advance(40);socket.onmessage({data:JSON.stringify({type:'pong',id})});
  finish({ok:true,json:async()=>({type:'pong'})});await stale;assert.equal(a.w.document.querySelector('.latency-label').textContent,'延迟 40ms');
 }finally{a.dom.window.close();}
});
test('in-game toolbar shows server RTT without replacing the game iframe',async()=>{
 const r=initial();r.stage='playing';r.session_id='ping-session';r.session_members=['p0','p1'];const a=await app(r);try{
  const frame=a.w.document.querySelector('iframe'),socket=a.sockets.at(-1),id=socket.sent.find(m=>m.type==='ping').id;a.advance(350);socket.onmessage({data:JSON.stringify({type:'pong',id})});
  assert.equal(a.w.document.querySelector('.game-toolbar .latency-label').textContent,'延迟 350ms');assert.equal(a.w.document.querySelector('.game-toolbar .latency-badge').dataset.level,'bad');assert.equal(a.w.document.querySelector('iframe'),frame);
  a.w.dispatchEvent(new a.w.Event('offline'));assert.match(a.w.document.querySelector('.game-toolbar .latency-label').textContent,/未连接/);
 }finally{a.dom.window.close();}
});
