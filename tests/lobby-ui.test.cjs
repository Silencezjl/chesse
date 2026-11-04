const {test} = require('node:test');
const assert = require('node:assert/strict');
const {JSDOM} = require('jsdom');
const fs = require('node:fs');
const source = fs.readFileSync('lobby-web/lobby.js','utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const initial = () => ({id:'123456',owner_id:'p0',game_id:'cheese',options:{max_dice:6},stage:'waiting',seats:['p0','p1'],revision:1,session_id:null,session_members:[],server_time:Date.now()/1000,members:{p0:{name:'房主',avatar:'🐭',connected:true,ready:false},p1:{name:'朋友',avatar:'🦊',connected:true,ready:false}}});
const tick = () => new Promise(resolve=>setImmediate(resolve));
async function app(start=initial()) {
  let room=clone(start);const calls=[],sockets=[],intervals=[];
  const dom=new JSDOM('<div id="app"></div><section id="game-shell" hidden></section><div id="toast"></div>',{url:'http://example.test/',runScripts:'outside-only'});
  const w=dom.window;w.localStorage.setItem('lobby_player_id','p0');w.localStorage.setItem('lobby_name','房主');
  w.setInterval=fn=>{intervals.push(fn);return intervals.length;};
  w.fetch=async(url,opts)=>{
    calls.push({url,body:opts?.body?JSON.parse(opts.body):undefined});
    if(url==='/lobby/games')return {ok:true,json:async()=>[{id:'cheese',title:'奶酪大盗',icon:'🧀',minimum:5,maximum:8,entry:'/cheese/',description:'推理',tag:'推理',settings:[{key:'max_dice',label:'骰子面数',type:'number',min:6,max:10,default:6}]}]};
    if(url.includes('/players/'))return {ok:true,json:async()=>({room_id:room.id})};
    if(url.includes('manage?action=kick')){const p=JSON.parse(opts.body).target_id;delete room.members[p];room.seats=room.seats.filter(x=>x!==p);room.revision++;}
    if(url.endsWith('/ready')){room.members.p0.ready=JSON.parse(opts.body).ready;}
    return {ok:true,json:async()=>clone(room)};
  };
  class Socket {
    static OPEN=1;
    constructor(){this.readyState=1;sockets.push(this);queueMicrotask(()=>this.onopen?.());}
    send(){}
    close(){this.readyState=3;}
    message(data){this.onmessage?.({data:JSON.stringify({type:'room_state',data:clone(data)})});}
  }
  w.WebSocket=Socket;w.eval(source);await tick();await tick();
  return {w,dom,calls,sockets,intervals,setRoom:r=>{room=clone(r);sockets.at(-1).message(room);}};
}
test('room updates preserve an unfinished settings edit and input focus',async()=>{
  const a=await app();try{
    const input=a.w.document.querySelector('[data-setting=max_dice]');input.focus();input.value='9';input.dispatchEvent(new a.w.Event('input',{bubbles:true}));
    const next=initial();next.members.p1.ready=true;a.setRoom(next);
    const replacement=a.w.document.querySelector('[data-setting=max_dice]');assert.equal(replacement.value,'9');assert.equal(a.w.document.activeElement,replacement);
  }finally{a.dom.window.close();}
});
test('kick uses an accessible in-page confirmation; cancel never calls the API',async()=>{
  const a=await app();try{
    a.w.document.querySelector('[data-kick=p1]').click();assert.ok(a.w.document.querySelector('[role=dialog][aria-modal=true]'));assert.ok(a.w.document.querySelector('.shell').hasAttribute('inert'));
    a.w.document.querySelector('#cancel-kick').click();assert.equal(a.w.document.querySelector('[role=dialog]'),null);assert.equal(a.calls.filter(c=>c.url.includes('/manage')).length,0);
    a.w.document.querySelector('[data-kick=p1]').click();a.w.document.querySelector('#confirm-kick').click();await tick();
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
