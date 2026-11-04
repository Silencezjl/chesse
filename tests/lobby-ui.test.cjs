const {test} = require('node:test');
const assert = require('node:assert/strict');
const {JSDOM} = require('jsdom');
const fs = require('node:fs');
const source = fs.readFileSync('lobby-web/lobby.js','utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const initial = () => ({id:'123456',owner_id:'p0',game_id:'cheese',options:{max_dice:6},stage:'waiting',seats:['p0','p1'],revision:1,session_id:null,session_members:[],server_time:Date.now()/1000,members:{p0:{name:'房主',avatar:'🐭',connected:true,ready:false},p1:{name:'朋友',avatar:'🦊',connected:true,ready:false}}});
const tick = () => new Promise(resolve=>setImmediate(resolve));
async function app(start=initial(), directory=[]) {
  let room=clone(start);const calls=[],sockets=[],intervals=[];
  const dom=new JSDOM('<div id="app"></div><section id="game-shell" hidden></section><div id="toast"></div>',{url:'http://example.test/',runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window;w.localStorage.setItem('lobby_player_id','p0');w.localStorage.setItem('lobby_name','房主');
  w.setInterval=fn=>{intervals.push(fn);return intervals.length;};
  w.fetch=async(url,opts)=>{
    calls.push({url,body:opts?.body?JSON.parse(opts.body):undefined});
    if(url==='/lobby/games')return {ok:true,json:async()=>[{id:'cheese',title:'奶酪大盗',icon:'/assets/game-cheese-indigo-v1.webp',minimum:5,maximum:8,entry:'/cheese/',description:'推理',tag:'推理',settings:[{key:'max_dice',label:'骰子面数',type:'number',min:6,max:10,default:6}]}]};
    if(url==='/lobby/rooms'&&!opts?.body)return {ok:true,json:async()=>clone(directory)};
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
    constructor(){this.readyState=1;sockets.push(this);queueMicrotask(()=>{this.onopen?.();this.message(room);});}
    send(){}
    close(){this.readyState=3;}
    message(data){this.onmessage?.({data:JSON.stringify({type:'room_state',data:clone(data)})});}
  }
  w.WebSocket=Socket;w.eval(fs.readFileSync('lobby-web/avatars.js','utf8'));w.eval(source);await tick();await tick();
  return {w,dom,calls,sockets,intervals,setRoom:r=>{room=clone(r);sockets.at(-1).message(room);}};
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
    assert.equal(call.body.name,'房主');assert.equal(call.body.avatar,'avatar-01');
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
    a.w.document.querySelector('#profile-form').dispatchEvent(new a.w.Event('submit',{bubbles:true,cancelable:true}));await tick();await tick();
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
    a.w.document.querySelector('[data-avatar="avatar-02"]').click();
    a.w.document.querySelector('#profile-form').dispatchEvent(new a.w.Event('submit',{bubbles:true,cancelable:true}));await tick();
    assert.equal(a.w.localStorage.getItem('lobby_name'),'新名字');assert.equal(a.w.localStorage.getItem('lobby_avatar'),'avatar-02');
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
    const image=a.w.document.querySelector('#my-profile img');assert.equal(image.getAttribute('src'),'/assets/avatars/avatar-01.svg');
    assert.equal(a.w.document.querySelector('#my-profile').textContent,'房主');
  }finally{a.dom.window.close();}
});
test('avatar URLs stay local for legacy values, supported IDs and untrusted values',async()=>{
  const a=await app();try{
    assert.equal(a.w.GameAvatars.normalize('🦊'),'avatar-02');
    assert.equal(a.w.GameAvatars.src('avatar-08'),'/assets/avatars/avatar-08.svg');
    assert.equal(a.w.GameAvatars.src('https://example.test/track.svg'),'/assets/avatars/avatar-01.svg');
    assert.equal(a.w.GameAvatars.ids.length,8);
  }finally{a.dom.window.close();}
});
