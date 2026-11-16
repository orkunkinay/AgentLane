import {chromium} from 'playwright';
import {mkdtemp,rm,mkdir,writeFile,cp,appendFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';

// Synthetic session values remain local; never accesses a real profile.
const fixture = `<!doctype html><style>body{margin:0;font:24px system-ui}input{position:absolute;left:40px;top:60px;width:320px;height:40px}button{position:absolute;left:40px;top:140px;width:180px;height:50px}canvas{position:absolute;top:250px}#result{position:absolute;top:210px}#long{height:2500px}</style><input aria-label="Text"><button onclick="document.querySelector('#result').textContent='Saved '+document.querySelector('input').value">Save</button><div id="result"></div><canvas width="300" height="150"></canvas><div id="long"></div><script>window.trusted=[];for(const t of ['click','keydown','input','wheel'])addEventListener(t,e=>trusted.push({type:t,trusted:e.isTrusted}));let c=document.querySelector('canvas').getContext('2d');c.fillStyle='teal';c.fillRect(0,0,300,150);c.fillStyle='white';c.fillText('Real compositor pixels',20,60);</script>`;
const server = createServer((req,res)=>{
  if(req.url==='/seed'){res.setHeader('Set-Cookie','still_fixture=local-session; HttpOnly; SameSite=Lax; Path=/');res.end('Synthetic human session established');}
  else if(req.url==='/auth'){res.end(req.headers.cookie?.includes('still_fixture=local-session')?'AUTHENTICATED':'LOGGED OUT');}
  else {res.setHeader('Content-Type','text/html');res.end(fixture);}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
const profile=await mkdtemp(join(tmpdir(),'still-experiment-'));
let context;
try {
  const extension=join(profile,'test-extension');
  await cp(resolve('extension'),extension,{recursive:true});
  await appendFile(join(extension,'worker.js'),'\nglobalThis.testLane = lane; // Instrumented disposable test build only\n');
  const opts={headless:!process.env.STILL_HEADED,channel:'chromium',args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]};
  if(process.env.STILL_CHROME) {delete opts.channel;opts.executablePath=process.env.STILL_CHROME;}
  context=await chromium.launchPersistentContext(profile,opts);
  const human=context.pages()[0];await human.goto(origin+'/seed');await human.goto(origin+'/');
  const worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const init=await worker.evaluate(async ({origin})=>{
    const lane=globalThis.testLane;
    const w=await chrome.windows.create({url:chrome.runtime.getURL('anchor.html'),focused:false,type:'normal'});
    lane.configure(w.id,[origin]);
    globalThis.testLane=lane;
    return {version:navigator.userAgent,windowId:w.id};
  },{origin});
  const call=async(op,args={})=>{
    process.stderr.write('experiment: '+op+'\n');
    let deadline;try{return await Promise.race([worker.evaluate(async ({op,args})=>globalThis.testLane.run({session:'experiment',op,args}),{op,args}),new Promise((_,reject)=>{deadline=setTimeout(()=>reject(Error('Timed out: '+op)),8000);})]);}finally{clearTimeout(deadline);}
  };
  // Real native/OS focus is outside a headless experiment's observable surface.
  await call('open',{url:origin+'/auth'});
  let agent;
  for(let i=0;i<200;i++){agent=context.pages().find(p=>p.url()===origin+'/auth');if(agent)break;await new Promise(r=>setTimeout(r,20));}
  assert(agent,'Agent page discovered by fixture URL, excluding delayed anchor events');
  await agent.waitForLoadState();
  assert.equal(await agent.locator('body').innerText(),'AUTHENTICATED');
  await call('navigate',{url:origin+'/'});await agent.waitForURL(origin+'/');await agent.waitForLoadState();
  await human.locator('input').fill('human-keeps-this');
  async function act(op,args) {const shot=await call('screenshot');assert(Buffer.from(shot.data,'base64').subarray(1,4).equals(Buffer.from('PNG')));return call(op,{...args,frame:shot.frame});}
  await act('click',{x:100,y:80});
  await act('type',{text:'agent-only'});
  await act('click',{x:100,y:165});
  assert.equal(await agent.locator('#result').innerText(),'Saved agent-only');
  assert.equal(await human.locator('input').inputValue(),'human-keeps-this');
  await act('scroll',{x:600,y:450,deltaX:0,deltaY:300});
  for(let i=0;i<30;i++) {
    await Promise.all([human.locator('input').fill('human-'+i),act('key',{key:'Tab'})]);
    assert.equal(await human.locator('input').inputValue(),'human-'+i);
  }
  const trusted=await agent.evaluate(()=>window.trusted);
  assert(trusted.some(e=>e.type==='click'&&e.trusted));
  assert(trusted.some(e=>e.type==='input'&&e.trusted));
  const shot=await call('screenshot');
  await assert.rejects(call('click',{x:1,y:1,frame:'stale'}),/Stale/);
  await assert.rejects(call('navigate',{url:'https://unapproved.example/'}),/approved/);
  await assert.rejects(call('Runtime.evaluate',{expression:'document.cookie'}),/Unsupported/);
  await mkdir('artifacts',{recursive:true});await writeFile('artifacts/agent.png',Buffer.from(shot.data,'base64'));
  const report={...init,mode:opts.headless?'headless':'headed',backend:'real chrome.debugger extension API',syntheticHttpOnlySession:true,visualCoordinateWorkflow:true,trustedClickAndText:true,concurrentRendererRounds:30,humanFieldUnchanged:true,osKeyboardMouseSpaces:'NOT TESTED',realExistingAccount:'NOT TESTED'};
  console.log(JSON.stringify(report,null,2));
  await writeFile('artifacts/browser-report.json',JSON.stringify(report,null,2)+'\n');
  await call('close');
} finally {await context?.close();server.close();await rm(profile,{recursive:true,force:true});}
