// Checks the diagnostic UI and real browser API lifecycle; it cannot verify a phone's physical display.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
 try{
  const context=await browser.newContext({viewport:{width:360,height:800},isMobile:true,hasTouch:true});
  const page=await context.newPage(),errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
  await page.addInitScript(()=>{
   const copy=navigator.clipboard.writeText.bind(navigator.clipboard);navigator.clipboard.writeText=async text=>{await copy(text);window.copiedReport=JSON.parse(text);};
   window.nativeLocks=[];const original=navigator.wakeLock.request.bind(navigator.wakeLock);
   navigator.wakeLock.request=async type=>{const lock=await original(type);window.nativeLocks.push(lock);return lock;};
  });
  await page.route('https://platform.test/**',route=>route.fulfill({contentType:'text/html',body:fs.readFileSync('dist/awake-check.html','utf8')}));
  await page.goto('https://platform.test/awake-check.html');await page.locator('#start').click();
  await page.waitForFunction(()=>window.nativeLocks.length===1&&!window.nativeLocks[0].released).catch(async error=>{throw Error(error.message+' '+await page.locator('#report').inputValue());});
  for(const theme of ['light','dark']){
   await page.emulateMedia({colorScheme:theme});
   for(const width of [320,360,430]){
    await page.setViewportSize({width,height:800});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    assert.ok((await page.locator('#start').boundingBox()).height>=48);
   }
  }
  await page.evaluate(()=>window.nativeLocks[0].release());await page.waitForFunction(()=>JSON.parse(document.querySelector('#report').value).runs[0].result==='interrupted');
  assert.equal(await page.evaluate(()=>window.nativeLocks.length),1);
  await page.locator('#fullscreen').click();await page.waitForFunction(()=>Boolean(document.fullscreenElement));
  await page.locator('#start').click();await page.waitForFunction(()=>window.nativeLocks.length===2);
  await page.locator('#copy').click();await page.waitForFunction(()=>Boolean(window.copiedReport));const report=await page.evaluate(()=>window.copiedReport);
  assert.equal(report.kind,'native-wake-lock-control');assert.equal(report.runs[1].fullscreen,true);assert.equal(report.released,false);
  await page.locator('#stop').click();await page.waitForFunction(()=>window.nativeLocks.every(l=>l.released));
  assert.ok(requests.every(u=>u==='https://platform.test/awake-check.html'),JSON.stringify(requests));assert.deepEqual(errors,[]);
  await page.screenshot({path:'/tmp/native-awake-control.png',animations:'disabled'});
  console.log('PASS native control: real browser acquire/release, interrupted result, fullscreen, clipboard, 320–430px; no game/API requests');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
