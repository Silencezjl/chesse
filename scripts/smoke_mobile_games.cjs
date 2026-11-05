// Run only against an isolated development instance. Playwright is optional tooling.
if (!['18088','18089'].includes(new URL(process.env.LOBBY_URL || 'http://localhost:18088').port)) throw Error('Use isolated development port 18088 or 18089');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');const assert=require('node:assert/strict');
(async()=>{const base=process.env.LOBBY_URL || 'http://localhost:18088',errors=[];const b=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || undefined,args:['--no-sandbox']});
const req=async(path,body)=>{const r=await fetch(base+'/lobby'+path,body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{});const d=await r.json();assert.ok(r.ok,JSON.stringify(d));return d;};
try{for(const game of ['cheese','bluff']){
 const count=game==='cheese'?5:3,ids=Array.from({length:count},(_,i)=>`mobile_${Date.now()}_${i}`),pages=[],contexts=[];
 const rid=(await req('/rooms',{player_id:ids[0],name:'手机'+game+'测试',avatar:'🐭',game_id:game})).id;
 for(let i=1;i<count;i++)await req(`/rooms/${rid}/join`,{player_id:ids[i],name:'朋友'+i,avatar:'🐸'});
 for(const pid of ids){const c=await b.newContext({viewport:{width:360,height:800},isMobile:true,hasTouch:true});contexts.push(c);await c.addInitScript(({pid})=>{localStorage.setItem('lobby_player_id',pid);},{pid});const p=await c.newPage();p.on('pageerror',e=>errors.push(e.stack));await p.goto(base);await p.locator('#ready:not(:disabled)').waitFor();pages.push(p);}
 for(const p of pages)await p.locator('#ready').click();
 for(const p of pages)await p.locator('iframe').waitFor();
 const frames=pages.map(p=>p.frameLocator('iframe'));
 await pages[0].locator('#fullscreen-game').click();await pages[0].waitForFunction(()=>document.fullscreenElement);
 if(game==='cheese'){
  for(let i=0;i<count;i++){await frames[i].getByRole('button',{name:'查看身份与私密信息'}).waitFor();assert.equal(await frames[i].getByText('你的骰子:',{exact:false}).count(),0);await frames[i].getByRole('button',{name:'查看身份与私密信息'}).click();}
  for(const f of frames){for(const label of ['选为共犯','偷看']){const target=f.getByRole('button',{name:label,exact:true});if(await target.count()){await target.first().click();await f.getByRole('button',{name:'确认提交'}).click();await f.getByRole('dialog').waitFor({state:'detached'});}}}
  await pages[0].screenshot({path:'/tmp/chesse-cheese-360.png'});
  await pages[0].locator('#show-room').click();await pages[0].locator('#resume').click();await frames[0].getByRole('button',{name:'查看身份与私密信息'}).waitFor();assert.equal(await frames[0].getByText('你的骰子:',{exact:false}).count(),0);
  for(const f of frames)await f.getByRole('button',{name:'结束夜晚行动'}).click();
  for(const f of frames)await f.getByRole('button',{name:'发起投票',exact:true}).waitFor();
  for(const f of frames.slice(0,3))await f.getByRole('button',{name:'发起投票',exact:true}).click();
  for(const f of frames){await f.getByRole('button',{name:'投票',exact:true}).first().click();await f.getByRole('button',{name:'确认提交'}).click();}
  await frames[0].getByText('查看身份与行动过程',{exact:false}).click();assert.ok(await pages[0].frames()[1].evaluate(()=>document.scrollingElement.scrollHeight>innerHeight));
 }else{
  for(const f of frames)await f.locator('#role-toggle').waitFor();
  for(const f of frames)assert.equal(await f.locator('.role').count(),0);
  const judgeIndex=await (async()=>{for(let i=0;i<count;i++)if(await frames[i].locator('.draw').count())return i;})();
  await frames[judgeIndex].locator('.draw').first().click();
  for(const f of frames){await f.locator('#role-toggle').click();await f.locator('#ready').click();}
  await frames[0].locator('#countdown').waitFor();await pages[0].screenshot({path:'/tmp/chesse-bluff-360.png'});
  await frames[judgeIndex].getByText('放下手机，面对面讨论',{exact:true}).waitFor({timeout:15000});
  for(let step=0;step<2;step++){await frames[judgeIndex].locator('.target').first().click();await frames[judgeIndex].locator('#confirm-target').click();await frames[judgeIndex].getByRole('dialog').waitFor({state:'detached'});}
  await frames[0].getByRole('heading',{name:'本轮揭晓',exact:true}).waitFor();
  // End the session after the completed round through the actual confirmation UI.
  await frames[0].locator('#scores summary').click();await frames[0].locator('#terminate').click();await frames[0].locator('#confirm-target').click();await frames[0].getByText('本局已提前结束',{exact:true}).waitFor();
 }
 for(const width of [320,360,390,430]){await pages[0].setViewportSize({width,height:800});assert.ok(await pages[0].evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.ok(await pages[0].evaluate(()=>document.scrollingElement.scrollHeight<=innerHeight+1));const frame=pages[0].frames()[1];assert.ok(await frame.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${game} overflow ${width}`);}
 const child=pages[0].frames()[1];const bottom=await child.evaluate(()=>{scrollTo(0,1e6);return {y:scrollY,h:innerHeight,total:document.scrollingElement.scrollHeight};});if(bottom.total>bottom.h+1)assert.ok(bottom.y>0);
 await pages[0].mouse.move(4,4);await pages[0].mouse.wheel(0,500);assert.equal(await pages[0].evaluate(()=>scrollY),0);
 for(const pid of [...ids].reverse())await req(`/rooms/${rid}/leave`,{player_id:pid});for(const c of contexts)await c.close();
 console.log('PASS:',game,'full-screen outer viewport pinned, long content remains scrollable, private panels, target confirmation, full round, 320–430px layout');
 }assert.deepEqual(errors,[]);
}finally{await b.close();}})().catch(e=>{console.error(e);process.exit(1)});
