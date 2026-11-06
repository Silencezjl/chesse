// Run only against an isolated development instance. Playwright is optional tooling.
if (!['18088','18089'].includes(new URL(process.env.LOBBY_URL || 'http://localhost:18088').port)) throw Error('Use isolated development port 18088 or 18089');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');const assert=require('node:assert/strict');
(async()=>{const base=process.env.LOBBY_URL || 'http://localhost:18088',errors=[];const b=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || undefined,args:['--no-sandbox']});
const assertBottom=async(frame,selector)=>{const info=await frame.locator(selector).evaluate(el=>{const bar=el.closest('.game-actions,.cheese-actions');const b=el.getBoundingClientRect(),a=bar.getBoundingClientRect();return {bottom:a.bottom,height:innerHeight,top:b.top,buttonBottom:b.bottom,width:b.width};});assert.ok(Math.abs(info.bottom-info.height)<2,JSON.stringify(info));assert.ok(info.top>=0&&info.buttonBottom<=info.height&&info.width>=44,JSON.stringify(info));};
const cookies=new Map();const req=async(path,body)=>{const pid=body?.player_id || new URL(base+path).searchParams.get('player_id');const r=await fetch(base+'/lobby'+path,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(pid?{cookie:cookies.get(pid)}:{})},...(body?{body:JSON.stringify(body)}:{})});const d=await r.json();assert.ok(r.ok,JSON.stringify(d));return d;};
try{for(const game of ['cheese','bluff']){
 const count=game==='cheese'?5:3,ids=[],pages=[],contexts=[];
 for(let i=0;i<count;i++){const r=await fetch(base+'/lobby/identity',{method:'POST'});const data=await r.json();ids.push(data.player_id);cookies.set(data.player_id,r.headers.get('set-cookie').split(';')[0]);}
 const rid=(await req('/rooms',{player_id:ids[0],name:'手机'+game+'测试',avatar:'🐭',game_id:game})).id;
 for(let i=1;i<count;i++)await req(`/rooms/${rid}/join`,{player_id:ids[i],name:'朋友'+i,avatar:'🐸'});
 for(const pid of ids){const c=await b.newContext({viewport:{width:360,height:800},isMobile:true,hasTouch:true});contexts.push(c);await c.addCookies([{name:'lobby_session',value:cookies.get(pid).split('=')[1],url:base}]);const p=await c.newPage();p.on('pageerror',e=>errors.push(e.stack));await p.goto(base);await p.locator('#ready:not(:disabled)').waitFor();pages.push(p);}
 for(const p of pages)await p.locator('#ready').click();
 for(const p of pages)await p.locator('iframe').waitFor();
 const frames=pages.map(p=>p.frameLocator('iframe'));
 await pages[0].locator('#fullscreen-game').click();await pages[0].waitForFunction(()=>document.fullscreenElement);
 if(game==='cheese'){
  for(const width of [320,360,390,430]){await pages[0].setViewportSize({width,height:640});await assertBottom(frames[0],'button[style*="touch-action"]');}
  await pages[0].setViewportSize({width:360,height:800});
  for(let i=0;i<count;i++){
   await pages[i].bringToFront();const f=frames[i],role=f.getByRole('button',{name:'按住查看身份与私密信息'});await f.locator('button:not([disabled])').filter({hasText:'按住查看身份与私密信息'}).waitFor();
   await assertBottom(f,'button[style*="touch-action"]');
   assert.equal(await f.getByText('你的骰子:',{exact:false}).count(),0);
   assert.equal(await f.getByRole('button',{name:'结束夜晚行动'}).isDisabled(),true);
   const box=await role.boundingBox(),touch=await contexts[i].newCDPSession(pages[i]);
   await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width/2,y:box.y+box.height/2}]});
   const card=f.getByAltText('角色卡牌');await card.waitFor();const visibleCard=await card.boundingBox();assert.ok(visibleCard.y>=0&&visibleCard.y+visibleCard.height<=800);await card.evaluate(image=>new Promise((resolve,reject)=>{if(image.complete)return image.naturalWidth?resolve():reject(Error('Role image failed'));image.onload=resolve;image.onerror=reject;}));
   await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await card.waitFor({state:'detached'});
   if(i===0){
    await role.focus();await pages[i].keyboard.down('Space');await card.waitFor();await pages[i].keyboard.up('Space');await card.waitFor({state:'detached'});
    await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width/2,y:box.y+box.height/2}]});await card.waitFor();
    await touch.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});await card.waitFor({state:'detached'});
   }
   await touch.detach();
  }
  let thiefIndex=-1;for(let i=0;i<count;i++)if(await frames[i].getByRole('button',{name:'选为共犯',exact:true}).count())thiefIndex=i;
  assert.notEqual(thiefIndex,-1);await pages[thiefIndex].reload();await frames[thiefIndex].getByRole('button',{name:'选为共犯',exact:true}).first().waitFor();assert.equal(await frames[thiefIndex].getByAltText('角色卡牌').count(),0);
  for(const f of frames){for(const label of ['选为共犯','偷看']){const target=f.getByRole('button',{name:label,exact:true});if(await target.count()){await target.first().click();await f.getByRole('button',{name:'确认提交'}).click();await f.getByRole('dialog').waitFor({state:'detached'});}}}
  await pages[0].screenshot({path:'/tmp/chesse-cheese-360.png'});
  await pages[0].locator('#show-room').click();await pages[0].locator('#resume').click();await frames[0].getByRole('button',{name:'按住查看身份与私密信息'}).waitFor();assert.equal(await frames[0].getByText('你的骰子:',{exact:false}).count(),0);
  for(const f of frames)await f.getByRole('button',{name:'结束夜晚行动'}).click();
  for(const f of frames)await f.getByRole('button',{name:'发起投票',exact:true}).waitFor();
  for(const f of frames.slice(0,3))await f.getByRole('button',{name:'发起投票',exact:true}).click();
  for(const f of frames){await f.getByRole('button',{name:'投票',exact:true}).first().click();await f.getByRole('button',{name:'确认提交'}).click();}
  await frames[0].getByText('查看身份与行动过程',{exact:false}).click();assert.ok(await pages[0].frames()[1].evaluate(()=>document.scrollingElement.scrollHeight>innerHeight));
 }else{
  for(const f of frames)await f.locator('#role-toggle').waitFor();
  for(const f of frames)assert.equal(await f.locator('.role').count(),0);
  const judgeIndex=await (async()=>{for(let i=0;i<count;i++)if(await frames[i].locator('.bank-tab').count())return i;})();
  await frames[judgeIndex].locator('[data-bank="1"]').click();
  await frames[judgeIndex].locator('.question-option').first().click();
  await frames[0].locator('#ready').waitFor();
  for(const width of [320,360,390,430]){await pages[0].setViewportSize({width,height:640});await assertBottom(frames[0],'#role-toggle');await assertBottom(frames[0],'#ready');}
  await pages[0].setViewportSize({width:360,height:800});
  for(let i=0;i<count;i++){
   const f=frames[i],role=f.locator('#role-toggle');await f.locator('#ready').waitFor();await assertBottom(f,'#role-toggle');await assertBottom(f,'#ready');assert.equal(await f.locator('#ready').isDisabled(),true);
   const box=await role.boundingBox(),touch=await contexts[i].newCDPSession(pages[i]);
   await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width/2,y:box.y+box.height/2}]});
   await f.locator('.role').waitFor();
   if(i===0){await new Promise(resolve=>setTimeout(resolve,6500));assert.equal(await f.locator('.role').count(),1,'identity must stay visible during a long hold and room refresh');}
   const card=f.locator('.role-card img');const visibleCard=await card.boundingBox();const description=await f.locator('.role-description').boundingBox();assert.ok(visibleCard.y>=0&&visibleCard.y+visibleCard.height<=800);assert.ok(description.y>=visibleCard.y+visibleCard.height,'role description should be below the card');assert.ok(visibleCard.width>=180,'role card should be large enough to read');await card.evaluate(image=>new Promise((resolve,reject)=>{if(image.complete)return image.naturalWidth?resolve():reject(Error('Role image failed'));image.onload=resolve;image.onerror=reject;}));
   await pages[i].screenshot({path:`/tmp/chesse-bluff-role-${i}.png`});
   await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
   await f.locator('.role').waitFor({state:'detached'});assert.equal(await f.locator('#ready').isEnabled(),true);await touch.detach();
  }
  await pages[0].reload();await frames[0].locator('#ready:not(:disabled)').waitFor();assert.equal(await frames[0].locator('.role').count(),0);
  for(const f of frames)await f.locator('#ready:not(:disabled)').click();
  await frames[0].locator('#countdown').waitFor();await pages[0].screenshot({path:'/tmp/chesse-bluff-360.png'});
  await frames[judgeIndex].getByText('放下手机，面对面讨论',{exact:true}).waitFor({timeout:15000});
  for(let step=0;step<2;step++){await frames[judgeIndex].locator('.target').first().click();await frames[judgeIndex].locator('#confirm-target').click();await frames[judgeIndex].getByRole('dialog').waitFor({state:'detached'});}
  await frames[0].getByRole('heading',{name:'本轮揭晓',exact:true}).waitFor();
  // End the session after the completed round through the actual confirmation UI.
  assert.equal(await frames[1].locator('#terminate').count(),0);
  await frames[0].locator('#terminate').click();await frames[0].locator('#cancel-target').click();
  await frames[0].locator('#terminate').click();await frames[0].locator('#confirm-target').click();await frames[0].getByText('本局已提前结束',{exact:true}).waitFor();
 }
 for(const width of [320,360,390,430]){await pages[0].setViewportSize({width,height:800});assert.ok(await pages[0].evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.ok(await pages[0].evaluate(()=>document.scrollingElement.scrollHeight<=innerHeight+1));const frame=pages[0].frames()[1];assert.ok(await frame.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${game} overflow ${width}`);}
 const child=pages[0].frames()[1];const bottom=await child.evaluate(()=>{scrollTo(0,1e6);return {y:scrollY,h:innerHeight,total:document.scrollingElement.scrollHeight};});if(bottom.total>bottom.h+1)assert.ok(bottom.y>0);
 await pages[0].mouse.move(4,4);await pages[0].mouse.wheel(0,500);assert.equal(await pages[0].evaluate(()=>scrollY),0);
 for(const pid of [...ids].reverse())await req(`/rooms/${rid}/leave`,{player_id:pid});for(const c of contexts)await c.close();
 console.log('PASS:',game,'full-screen outer viewport pinned, long content remains scrollable, private panels, target confirmation, full round, 320–430px layout');
 }assert.deepEqual(errors,[]);
}finally{await b.close();}})().catch(e=>{console.error(e);process.exit(1)});
