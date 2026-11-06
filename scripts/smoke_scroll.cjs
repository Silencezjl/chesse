// Node.js 22+ and Playwright. Isolated instances only; creates and cleans its own test room.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright'),assert=require('node:assert/strict');
const base=process.env.LOBBY_URL || 'http://localhost:18088';if(!['18088','18089'].includes(new URL(base).port))throw Error('Use isolated development port 18088 or 18089');
const ids=[],cookies=new Map();const WebSocket=require('ws');let rid,last,finished=false;const feeds=[],gameFeeds=new Map();
const wait=async check=>{for(let i=0;i<400;i++){if(check())return;await new Promise(r=>setTimeout(r,25));}throw Error('Timed out waiting for game state');};
const req=async(path,body)=>{const pid=body?.player_id || new URL(base+path).searchParams.get('player_id');const r=await fetch(base+'/lobby'+path,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(pid?{cookie:cookies.get(pid)}:{})},...(body?{body:JSON.stringify(body)}:{})});const data=await r.json();assert.ok(r.ok,JSON.stringify(data));return data;};
const feed=(path,capture=false)=>new Promise((resolve,reject)=>{const ws=new WebSocket(base.replace('http','ws')+path,{headers:{cookie:cookies.get(path.split('/').pop())}});feeds.push(ws);const timer=setTimeout(()=>reject(Error('Socket timeout '+path)),12000);ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.type==='room_state'){if(capture)last=m;clearTimeout(timer);resolve(ws);}});ws.addEventListener('error',reject);});
const finish=async()=>{if(finished)return;for(let i=0;i<16;i++){const room=last?.room,actor=room?.hand?.current_player_id;if(room?.status!=='playing'||!actor)break;gameFeeds.get(actor).send(JSON.stringify({type:'action',action:'fold'}));await wait(()=>last.room.status!=='playing'||last.room.hand?.current_player_id!==actor);}gameFeeds.get(ids[0]).send(JSON.stringify({type:'end_game'}));await wait(()=>last?.room?.status==='finished');finished=true;};
(async()=>{const b=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || undefined,args:['--no-sandbox']});try{
for(let i=0;i<12;i++){const r=await fetch(base+'/lobby/identity',{method:'POST'});const data=await r.json();ids.push(data.player_id);cookies.set(data.player_id,r.headers.get('set-cookie').split(';')[0]);}
// Short lobby pages do not scroll into padding; tall screens keep natural scrolling.
const home=await b.newPage({viewport:{width:360,height:800},isMobile:true,hasTouch:true});
await home.addInitScript(()=>localStorage.setItem('lobby_name','滚动检查'));
await home.route('**/lobby/rooms',r=>r.request().method()==='GET'?r.fulfill({json:[]}):r.continue());
await home.goto(base);await home.locator('#create-room').waitFor();
for(const width of [320,360,430]){await home.setViewportSize({width,height:800});assert.ok(await home.evaluate(()=>document.scrollingElement.scrollHeight<=innerHeight+1));}
await home.locator('#fullscreen-header').click();await home.waitForFunction(()=>document.fullscreenElement);
assert.ok(await home.evaluate(()=>document.scrollingElement.scrollHeight<=innerHeight+1));
await home.setViewportSize({width:360,height:640});await home.evaluate(()=>scrollTo(0,1e6));
const trailing=await home.locator('.game-shortcuts').evaluate(el=>document.querySelector('.home-action').getBoundingClientRect().top-el.getBoundingClientRect().bottom);assert.ok(trailing>=12&&trailing<=24,`Home footer overlaps content or leaves excess space: ${trailing}`);
const homeButton=await home.locator('#create-room').boundingBox();assert.ok(homeButton.y+homeButton.height<=640&&homeButton.y>500);
await home.close();
rid=(await req('/rooms',{player_id:ids[0],name:'滚动玩家0',avatar:'animal-01',game_id:'holdem'})).id;
for(let i=1;i<ids.length;i++)await req(`/rooms/${rid}/join`,{player_id:ids[i],name:'滚动玩家'+i,avatar:'animal-02'});
for(const pid of ids)await feed(`/lobby/rooms/${rid}/ws/${pid}`);
const c=await b.newContext({viewport:{width:360,height:800},isMobile:true,hasTouch:true});await c.addCookies([{name:'lobby_session',value:cookies.get(ids[0]).split('=')[1],url:base}]);const p=await c.newPage();p.on('pageerror',e=>console.log('PAGE ERROR',e.message));await p.goto(base);await p.locator('#ready:not(:disabled)').waitFor();
await req(`/rooms/${rid}/game`,{player_id:ids[0],game_id:'cheese',options:{}});
await p.locator('.waiting-rules').getByText('夜晚行动',{exact:false}).first().waitFor();
await p.locator('#fullscreen-header').click();await p.waitForFunction(()=>document.fullscreenElement);
await p.evaluate(()=>scrollTo(0,1e6));
const gap=await p.evaluate(()=>document.querySelector('.action-bar').getBoundingClientRect().top-document.querySelector('.waiting-rules').getBoundingClientRect().bottom);
assert.ok(gap>=12&&gap<=24,`Unexpected blank footer space: ${gap}`);
await p.locator('#my-profile').evaluate(button=>button.click());
const background=await p.evaluate(()=>scrollY);await p.mouse.move(4,30);await p.mouse.wheel(0,500);await p.evaluate(()=>new Promise(requestAnimationFrame));assert.equal(await p.evaluate(()=>scrollY),background);
const avatarBox=await p.locator('.avatars').boundingBox();await p.mouse.move(avatarBox.x+avatarBox.width/2,avatarBox.y+avatarBox.height/2);await p.mouse.wheel(0,220);await p.waitForFunction(()=>document.querySelector('.avatars').scrollTop>0);assert.equal(await p.evaluate(()=>scrollY),background);
await p.locator('#close-sheet').click();assert.equal(await p.evaluate(()=>scrollY),background);
await p.locator('#fullscreen-header').click();await p.waitForFunction(()=>!document.fullscreenElement);
let config=await req(`/rooms/${rid}/game`,{player_id:ids[0],game_id:'holdem',options:{initial_chips:1000,hand_interval:60}});
for(const pid of ids)if(!config.seats.includes(pid))config=await req(`/rooms/${rid}/seat`,{player_id:ids[0],target_id:pid,seated:true});
for(const pid of ids)await req(`/rooms/${rid}/ready`,{player_id:pid,ready:true,revision:config.revision});await p.locator('iframe').waitFor();
assert.ok(await p.evaluate(()=>document.scrollingElement.scrollHeight<=innerHeight+1));
for(let i=0;i<ids.length;i++)gameFeeds.set(ids[i],await feed(`/holdem-ws/${rid}/${ids[i]}`,i===0));await finish();for(const ws of feeds)ws.close();
await p.reload();await p.locator('#room-menu').waitFor();await p.locator('#room-menu').click();await p.locator('[data-resume]').click();const frame=p.frameLocator('iframe');await frame.getByRole('button',{name:'返回首页',exact:true}).waitFor({state:'attached'});await p.locator('#fullscreen-game').click();await p.waitForFunction(()=>document.fullscreenElement);
const stats=await frame.getByRole('button',{name:'返回首页',exact:true}).evaluate(button=>({h:innerHeight,doc:document.scrollingElement.scrollHeight,box:button.parentElement.clientHeight,content:button.parentElement.scrollHeight,overflow:getComputedStyle(button.parentElement).overflowY,buttonBottom:button.getBoundingClientRect().bottom}));
assert.ok(stats.content>stats.box);assert.ok(stats.doc<=stats.h+1);
const frameBox=await p.locator('iframe').boundingBox();await p.mouse.move(frameBox.x+frameBox.width/2,frameBox.y+frameBox.height/2);await p.mouse.wheel(0,10000);
await p.waitForFunction(()=>{const w=document.querySelector('iframe').contentWindow,button=[...w.document.querySelectorAll('button')].find(b=>b.textContent.trim()==='返回首页');return button?.getBoundingClientRect().bottom<=w.innerHeight;});
assert.equal(await p.evaluate(()=>scrollY),0);
console.log('PASS: short full-screen lobby has no blank scroll; rules clear the footer; modal background stays fixed while avatars scroll; 12-player result list scrolls internally and its return button is reachable');
}catch(error){console.error("Test failed:",error);throw error;}finally{try{if(rid){if(!finished&&last?.room){try{await finish();}catch(e){console.error('Cleanup failed:',e.message);}}if(finished)for(const pid of [...ids].reverse())await req(`/rooms/${rid}/leave`,{player_id:pid});}}finally{for(const ws of feeds)ws.close();await b.close();}}})().catch(e=>{console.error(e);process.exit(1)});
