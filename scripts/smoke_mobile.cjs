// Run only against an isolated development instance. Playwright is optional tooling.
if (!['18088','18089'].includes(new URL(process.env.LOBBY_URL || 'http://localhost:18088').port)) throw Error('Use isolated development port 18088 or 18089');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || undefined,headless:true,args:['--no-sandbox']});
 const base=process.env.LOBBY_URL || 'http://localhost:18088', contexts=[],errors=[];let rid;
 const context=async(name)=>{const c=await browser.newContext({viewport:{width:360,height:800},isMobile:true,hasTouch:true});contexts.push(c);const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(base);await p.locator('#name').waitFor();assert.equal(await p.locator('#save-profile').isDisabled(),true);assert.equal(await p.locator('#close-sheet').count(),0);await p.keyboard.press('Escape');assert.ok(await p.locator('#name').isVisible());if(name)await p.locator('#name').fill(name);else await p.locator('#random-name').click();await p.locator('#save-profile').click();await p.locator('[role=dialog]').waitFor({state:'detached'});await p.locator('#create-room').waitFor();await p.waitForFunction(()=>/延迟 \d+ms/.test(document.querySelector('.top .latency-label')?.textContent || ''));return p;};
 const req=async(path,body)=>{const r=await fetch(base+'/lobby'+path,body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{});const d=await r.json();assert.ok(r.ok,JSON.stringify(d));return d;};
 try{
 const host=await context();await host.screenshot({path:'/tmp/chesse-home-360.png'});
 await host.locator('#create-room').click();await host.locator('#room-menu').waitFor();assert.equal(await host.locator('#name').count(),0);assert.equal(await host.locator('#password').count(),0);await host.locator('#game-picker').click();await host.locator('[data-game="holdem"]').click();await host.locator('#ready').waitFor();await host.waitForFunction(()=>/延迟 \d+ms/.test(document.querySelector('.top .latency-label')?.textContent || ''));
 rid=await host.evaluate(()=>localStorage.getItem('lobby_room_id'));const hostId=await host.evaluate(()=>localStorage.getItem('lobby_player_id'));
 assert.equal((await req(`/rooms/${rid}?player_id=${hostId}`)).has_password,false);
 await host.screenshot({path:'/tmp/chesse-room-360.png'});
 for(const [game,phrase] of [['cheese','独自醒来'],['bluff','质疑到瞎掰人'],['holdem','实体扑克牌']]){await host.locator('#game-picker').click();await host.locator(`[data-game="${game}"]`).click();await host.locator('.waiting-rules').getByText(phrase,{exact:false}).first().waitFor();}
 for(const width of [320,360,390,430]){await host.setViewportSize({width,height:800});assert.ok(await host.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`overflow rules ${width}`);}
 await host.setViewportSize({width:360,height:800});
 await host.locator('#room-menu').click();await host.locator('#edit-password').click();await host.locator('#password').fill('1234');await host.locator('#password-form button').last().click();await host.locator('[role=dialog]').waitFor({state:'detached'});assert.equal((await req(`/rooms/${rid}?player_id=${hostId}`)).has_password,true);
 const guest=await context('朋友甲');await guest.locator(`[data-join="${rid}"]`).click();assert.equal(await guest.locator('#name').count(),0);await guest.locator('#password').fill('wrong');await guest.locator('#room-form button').last().click();await guest.locator('[role=alert]').waitFor();await guest.locator('#password').fill('1234');await guest.locator('#room-form button').last().click();await guest.locator('#ready').waitFor();
 await guest.reload();await guest.locator('#ready').waitFor();assert.equal(await guest.evaluate(()=>localStorage.getItem('lobby_name')),'朋友甲');
 await host.locator('#ready').click();await guest.locator('#ready').click();await host.locator('iframe').waitFor();
 await host.locator('.game-toolbar .latency-badge').waitFor();await host.waitForFunction(()=>/延迟 \d+ms/.test(document.querySelector('.game-toolbar .latency-label')?.textContent || ''));
 const frame=host.frameLocator('iframe');await frame.getByText('小盲', {exact:false}).waitFor();await host.screenshot({path:'/tmp/chesse-holdem-360.png'});
 const late=await context('晚到朋友');await late.locator(`[data-join="${rid}"]`).click();assert.equal(await late.locator('#name').count(),0);await late.locator('#password').fill('1234');await late.locator('#room-form button').last().click();await late.getByText('你已加入候场。',{exact:false}).waitFor();assert.equal(await late.locator('iframe').count(),0);
 for(const width of [320,360,390,430]){await late.setViewportSize({width,height:800});assert.ok(await late.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`overflow candidate ${width}`);}
 await late.locator('#room-menu').click();await late.locator('#leave').click();await late.locator('#create-room').waitFor();
 await host.locator('#show-room').click();await host.locator('#resume').click();assert.equal(await host.locator('iframe').count(),1);
 const state=await req(`/rooms/${rid}?player_id=${hostId}`);const members=Object.keys(state.members);
 // Complete this hand, then end the chip session through its existing protocol.
 const socketPage=await browser.newPage();await socketPage.goto(base);
 const end=await socketPage.evaluate(async({rid,members,base})=>{
  return await new Promise((resolve,reject)=>{let sockets={},done=false;const timer=setTimeout(()=>reject(Error('end timeout')),15000);
   for(const pid of members){const ws=new WebSocket(base.replace('http','ws')+`/holdem-ws/${rid}/${pid}`);sockets[pid]=ws;ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.type!=='room_state')return;const r=m.room;if(r.status==='playing'&&r.hand?.current_player_id===pid)ws.send(JSON.stringify({type:'action',action:'fold'}));if(r.status==='waiting'&&pid===members[0])ws.send(JSON.stringify({type:'end_game'}));if(r.status==='finished'&&!done){done=true;clearTimeout(timer);Object.values(sockets).forEach(s=>s.close());resolve(true);}};}
  });
 },{rid,members,base});assert.ok(end);await socketPage.close();
 for(const pid of [...members].reverse())await req(`/rooms/${rid}/leave`,{player_id:pid});rid=null;
 assert.deepEqual(errors,[]);console.log('PASS: mandatory first profile, HTTP/WebSocket RTT, one-click unlocked creation, in-room password settings, all three inline game rules, password retry, saved profile/reload, Holdem iframe, candidate privacy/leave, 320–430px layout, cleanup');
 }finally{if(rid)console.log('Room requiring cleanup:',rid);await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
