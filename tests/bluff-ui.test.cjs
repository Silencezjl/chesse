const {test} = require('node:test');
const assert = require('node:assert/strict');
const {JSDOM} = require('jsdom');
const fs = require('node:fs');
const source = fs.readFileSync('bluff-web/game.js', 'utf8');

function openGame(storage = {}) {
  const dom = new JSDOM('<main id="app"></main>', {url:'http://example.test/bluff/?room=123456', runScripts:'outside-only'});
  const w = dom.window;
  w.localStorage.setItem('lobby_player_id', 'p1');
  for (const [key, value] of Object.entries(storage)) w.sessionStorage.setItem(key, value);
  w.GameAvatars = {html: () => ''};
  w.PlayerNames = {html: text => text};
  w.setInterval = () => 1;
  let socket;
  const messages = [];
  w.WebSocket = class {
    static OPEN = 1;
    constructor(){socket=this;this.readyState=1;}
    send(data){messages.push(JSON.parse(data));}
  };
  w.eval(source);
  return {w, dom, messages, send(data){socket.onmessage({data:JSON.stringify({type:'state', data})});}};
}

function state(session = 'session1', round = 1) {
  return {session_id:session, phase:'prepare', room_id:'123456', round, total_rounds:3,
    players:['p1','p2','p3'], members:{p1:{name:'玩家',avatar:'🐭'},p2:{name:'朋友',avatar:'🐭'},p3:{name:'小明',avatar:'🐭'}},
    judge:'p2', owner_id:'p2', scores:{p1:3,p2:3,p3:3}, ready_count:0, i_ready:false,
    my_role:'honest', paused:false, available:{1:20,2:20,3:20}};
}

function pointer(w, element, type, pointerId = 1) {
  const event = new w.MouseEvent(type, {bubbles:true, button:0});
  Object.defineProperty(event, 'pointerId', {value:pointerId});
  if (type === 'pointerdown') element.onpointerdown(event);
  else element.dispatchEvent(event);
}

test('hold reveals identity and release or cancellation hides it while preserving readiness', () => {
  const game = openGame();
  try {
    game.send(state());
    assert.equal(game.w.document.querySelector('#ready').disabled, true);
    const button = game.w.document.querySelector('#role-toggle');
    pointer(game.w, button, 'pointerdown');
    assert.equal(game.w.document.querySelector('.role').textContent, '老实人');
    const touch = new game.w.Event('touchstart', {bubbles:true, cancelable:true});
    button.dispatchEvent(touch);
    assert.equal(touch.defaultPrevented, true);
    const menu = new game.w.MouseEvent('contextmenu', {bubbles:true, cancelable:true});
    button.dispatchEvent(menu);
    assert.equal(menu.defaultPrevented, true);
    game.send(state());
    pointer(game.w, game.w.document.querySelector('#role-toggle'), 'pointerup');
    assert.equal(game.w.document.querySelector('.role'), null);
    assert.equal(game.w.document.querySelector('#ready').disabled, false);
    pointer(game.w, game.w.document.querySelector('#role-toggle'), 'pointerdown');
    pointer(game.w, game.w.document.querySelector('#role-toggle'), 'pointercancel');
    assert.equal(game.w.document.querySelector('.role'), null);
    assert.equal(game.w.document.querySelector('#ready').disabled, false);
    const role = game.w.document.querySelector('#role-toggle');
    role.dispatchEvent(new game.w.KeyboardEvent('keydown', {key:' ', bubbles:true}));
    assert.equal(game.w.document.querySelector('.role').textContent, '老实人');
    role.dispatchEvent(new game.w.KeyboardEvent('keyup', {key:' ', bubbles:true}));
    assert.equal(game.w.document.querySelector('.role'), null);
    pointer(game.w, game.w.document.querySelector('#role-toggle'), 'pointerdown');
    game.w.dispatchEvent(new game.w.Event('blur'));
    assert.equal(game.w.document.querySelector('.role'), null);
    game.send(state('session1', 2));
    assert.equal(game.w.document.querySelector('#ready').disabled, true);
    game.send(state('session2', 1));
    assert.equal(game.w.document.querySelector('#ready').disabled, true);
  } finally { game.dom.window.close(); }
});

test('viewed identity survives reload within the same session and round', () => {
  const first = openGame();
  first.send(state());
  pointer(first.w, first.w.document.querySelector('#role-toggle'), 'pointerdown');
  pointer(first.w, first.w.document.querySelector('#role-toggle'), 'pointerup');
  const saved = Object.fromEntries(Object.entries(first.w.sessionStorage));
  first.dom.window.close();
  const restored = openGame(saved);
  try {
    restored.send(state());
    assert.equal(restored.w.document.querySelector('.role'), null);
    assert.equal(restored.w.document.querySelector('#ready').disabled, false);
  } finally { restored.dom.window.close(); }
});

test('each role card is only rendered while its owner holds the button', () => {
  for (const [role, name] of [['judge','大聪明'],['honest','老实人'],['bluffer','瞎掰人']]) {
    const game = openGame();
    try {
      game.send({...state(), my_role:role});
      assert.equal(game.w.document.querySelector('.role-card'), null);
      pointer(game.w, game.w.document.querySelector('#role-toggle'), 'pointerdown');
      assert.equal(game.w.document.querySelector('.role').textContent, name);
      assert.equal(game.w.document.querySelector('.role-card img').getAttribute('src'), `/bluff/assets/role-${role}-v1.webp`);
      pointer(game.w, game.w.document.querySelector('#role-toggle'), 'pointerup');
      assert.equal(game.w.document.querySelector('.role-card'), null);
    } finally { game.dom.window.close(); }
  }
});

test('only the owner can open and confirm ending the game, including while paused', () => {
  const game = openGame();
  try {
    game.send(state());
    assert.equal(game.w.document.querySelector('#terminate'), null);
    game.send({...state(), owner_id:'p1', paused:true});
    assert.ok(game.w.document.querySelector('header #terminate'));
    assert.equal(game.w.document.querySelector('#scores #terminate'), null);
    game.w.document.querySelector('#terminate').click();
    assert.match(game.w.document.querySelector('[role=dialog]').textContent, /未完成回合不会计分/);
    game.w.document.querySelector('#cancel-target').click();
    assert.equal(game.messages.length, 0);
    game.w.document.querySelector('#terminate').click();
    game.w.document.querySelector('#confirm-target').click();
    assert.equal(game.messages[0].type, 'terminate');
  } finally { game.dom.window.close(); }
});


test('judge can browse a difficulty and select a particular question without exposing the bank to others', () => {
  const game = openGame();
  try {
    const bank = [{id:'q1',title:'第一题',difficulty:1,hints:['方向']},{id:'q2',title:'第二题',difficulty:2,hints:[]}];
    game.send({...state(),phase:'choose',judge:'p1',my_role:'judge',question_bank:bank});
    assert.match(game.w.document.querySelector('header').textContent, /你是大聪明/);
    assert.equal(game.w.document.querySelector('.question-option'), null);
    game.w.document.querySelector('[data-bank="1"]').click();
    assert.match(game.w.document.querySelector('.question-option').textContent, /第一题/);
    assert.equal(game.w.document.querySelectorAll('.question-option').length, 1);
    game.w.document.querySelector('[data-bank="2"]').click();
    assert.match(game.w.document.querySelector('.question-option').textContent, /第二题/);
    game.w.document.querySelector('[data-question="q2"]').click();
    assert.deepEqual(JSON.parse(JSON.stringify(game.messages[0])), {type:'select',data:{question_id:'q2'}});
    game.send({...state(),phase:'choose'});
    assert.equal(game.w.document.querySelector('.judge-tag'), null);
    assert.equal(game.w.document.querySelector('.question-picker'), null);
  } finally { game.dom.window.close(); }
});
